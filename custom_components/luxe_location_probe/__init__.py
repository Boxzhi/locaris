from pathlib import Path
import asyncio
import math
import logging
import secrets
import time
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from datetime import datetime, timedelta, timezone
from .location_store import now_ms, WINDOW
import voluptuous as vol
from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import callback
from .location_store import Store, position
_LOGGER = logging.getLogger(__name__)
DOMAIN = "luxe_location_probe"
PANEL = "luxe-location-probe"
@websocket_api.websocket_command({vol.Required("type"): DOMAIN + "/config"})
@websocket_api.require_admin
@callback
def ws_config(hass, connection, msg):
    data = hass.data.get(DOMAIN, {}).get("active")
    if not data:
        connection.send_error(msg["id"], "not_loaded", "Probe not loaded")
        return
    state = hass.data[DOMAIN]
    sessions = state.setdefault("proxy_sessions", {})
    now = time.monotonic()
    for token in list(sessions):
        if sessions[token]["expires"] <= now:
            sessions.pop(token)
    if len(sessions) >= 64:
        sessions.pop(next(iter(sessions)))
    token = secrets.token_urlsafe(32)
    sessions[token] = {"expires":now+43200,"times":[],"user":connection.user.id}
    connection.send_result(msg["id"], {"map_key":data["map_key"],"proxy_path":"/api/luxe_location/"+token+"/_AMapService"})
@websocket_api.websocket_command({vol.Required("type"): DOMAIN + "/storage", vol.Required("action"): vol.In(["list","enable","disable","add","remove"]), vol.Optional("entity_id"): str, vol.Optional("import_history", default=True): bool, vol.Optional("delete_history", default=False): bool, vol.Optional("include_position", default=False): bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_storage(hass, connection, msg):
    store = hass.data.get(DOMAIN, {}).get("store")
    if not store or not store.ready or not store.active:
        connection.send_error(msg["id"], "not_loaded", "Storage not ready")
        return
    try:
        action = msg["action"]
        await store.discover()
        if not store.active or not store.ready:
            connection.send_error(msg["id"], "not_loaded", "Storage not ready")
            return
        if action == "add":
            await store.add(msg.get("entity_id",""))
        elif action == "remove":
            await store.remove(msg.get("entity_id",""), msg["delete_history"])
        elif action == "enable":
            await store.enable(msg.get("entity_id",""), msg["import_history"])
        elif action == "disable":
            await store.disable(msg.get("entity_id",""))
        if action in ("remove","disable"):
            cache = hass.data[DOMAIN].get("address_cache",{})
            for key in list(cache):
                if key[0] == msg.get("entity_id"):
                    cache.pop(key,None)
        devices = []
        for entity in sorted(store.managed | store.excluded):
            state = hass.states.get(entity)
            pos = position(state)
            item = {"entity_id":entity,"name":state.name if state else entity,
                "managed":entity in store.managed,"enabled":entity in store.devices,
                "available":pos is not None}
            if msg["include_position"] and entity in store.managed and entity in store.devices and pos is not None:
                item["position"] = {"latitude":pos[0],"longitude":pos[1],"accuracy":pos[2],
                    "updated_at":int(state.last_updated.timestamp()*1000)}
            devices.append(item)
        connection.send_result(msg["id"], {"candidates":devices,"storage":await store.storage_stats()})
    except ValueError:
        connection.send_error(msg["id"], "invalid_device", "Invalid GPS device")
    except Exception:
        _LOGGER.warning("Location storage operation failed (no coordinates logged)")
        connection.send_error(msg["id"], "storage_failed", "Storage operation failed")

@websocket_api.websocket_command({vol.Required("type"): DOMAIN + "/history", vol.Required("entity_id"): str, vol.Required("start"): int, vol.Required("end"): int})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_history(hass, connection, msg):
    store = hass.data.get(DOMAIN, {}).get("store")
    if not store or not store.ready or not store.active:
        connection.send_error(msg["id"], "not_loaded", "Storage not ready")
        return
    entity = msg["entity_id"]
    start, end = msg["start"], msg["end"]
    if end <= start or end-start > 26*3600000:
        connection.send_error(msg["id"], "invalid_range", "Select one day")
        return
    async with store.lock:
        if not store.active or not store.ready or entity not in store.managed:
            connection.send_error(msg["id"], "invalid_device", "Device not managed")
            return
        def read(con):
            rows = con.execute("SELECT recorded_at,latitude,longitude,accuracy FROM probe_locations WHERE entity_id=? AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at LIMIT 10001", (entity,max(start,now_ms()-WINDOW),min(end,now_ms()+1))).fetchall()
            return [dict(r) for r in rows]
        try:
            rows = await store.run(read)
        except Exception:
            _LOGGER.warning("Location history query failed (no coordinates logged)")
            connection.send_error(msg["id"], "history_failed", "History query failed")
            return
    connection.send_result(msg["id"], {"points":rows[:10000],"truncated":len(rows)>10000})

def gcj(lon, lat):
    if not (72.004 <= lon <= 137.8347 and .8293 <= lat <= 55.8271):
        return lon, lat
    x,y = lon-105,lat-35
    pi,a,ee = math.pi,6378245,.006693421622965943
    dy=-100+2*x+3*y+.2*y*y+.1*x*y+.2*math.sqrt(abs(x))
    dx=300+x+2*y+.1*x*x+.1*x*y+.1*math.sqrt(abs(x))
    common=(20*math.sin(6*x*pi)+20*math.sin(2*x*pi))*2/3
    dy+=common+(20*math.sin(y*pi)+40*math.sin(y*pi/3))*2/3+(160*math.sin(y*pi/12)+320*math.sin(y*pi/30))*2/3
    dx+=common+(20*math.sin(x*pi)+40*math.sin(x*pi/3))*2/3+(150*math.sin(x*pi/12)+300*math.sin(x*pi/30))*2/3
    rad=lat*pi/180
    magic=1-ee*math.sin(rad)**2
    root=math.sqrt(magic)
    return lon+dx*180/(a/root*math.cos(rad)*pi),lat+dy*180/(a*(1-ee)/(magic*root)*pi)

class MapProxy(HomeAssistantView):
    url = "/api/luxe_location/{token}/_AMapService/{path:.*}"
    name = "api:luxe_location:map_proxy"
    requires_auth = False

    async def get(self, request, token, path):
        hass = request.app["hass"]
        state = hass.data.get(DOMAIN, {})
        data = state.get("active")
        session = state.get("proxy_sessions", {}).get(token)
        now = time.monotonic()
        if not data or not session or session["expires"] <= now:
            raise web.HTTPUnauthorized()
        user = await hass.auth.async_get_user(session["user"])
        if not user or not user.is_admin or not user.is_active:
            raise web.HTTPForbidden()
        # Explicit endpoints only. No arbitrary upstream paths or redirect following.
        allowed = {"v4/map/styles":"https://webapi.amap.com/v4/map/styles",
                   "v3/log/init":"https://restapi.amap.com/v3/log/init"}
        target = allowed.get(path)
        if not target:
            raise web.HTTPForbidden()
        if len(request.query_string)>8192:
            raise web.HTTPBadRequest()
        times = session["times"]
        times[:] = [t for t in times if now-t<60]
        if len(times)>=120:
            raise web.HTTPTooManyRequests()
        times.append(now)
        params = [(k,v) for k,v in request.query.items() if k.lower() not in ("key","jscode")]
        params.extend([("key",data["map_key"]),("jscode",data["security_code"])])
        try:
            async with async_get_clientsession(hass).get(target,params=params,allow_redirects=False,timeout=15) as resp:
                if resp.status!=200:
                    return web.Response(status=502)
                body=bytearray()
                async for chunk in resp.content.iter_chunked(65536):
                    body.extend(chunk)
                    if len(body)>4*1024*1024:
                        return web.Response(status=502)
                return web.Response(body=bytes(body),content_type=resp.content_type,headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer"})
        except Exception:
            return web.Response(status=502)

@websocket_api.websocket_command({vol.Required("type"): DOMAIN+"/address",vol.Required("entity_id"):str,vol.Optional("recorded_at"):int})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_address(hass,connection,msg):
    state=hass.data.get(DOMAIN,{})
    store=state.get("store")
    entity=msg["entity_id"]
    if not store or not store.ready or not store.active or entity not in store.managed:
        connection.send_error(msg["id"],"invalid_device","Device not managed")
        return
    # Resolve only existing authorized device positions, never arbitrary coordinates.
    async with store.lock:
        if not store.active or not store.ready or entity not in store.managed:
            connection.send_result(msg["id"],{"address":None})
            return
        initial_generation=store.generations.get(entity,0)
        if "recorded_at" in msg:
            row=await store.run(lambda c:c.execute("SELECT longitude,latitude FROM probe_locations WHERE entity_id=? AND recorded_at=? AND recorded_at>=?",(entity,msg["recorded_at"],now_ms()-WINDOW)).fetchone())
            coords=tuple(row) if row else None
        else:
            p=position(hass.states.get(entity)) if entity in store.devices else None
            coords=(p[1],p[0]) if p else None
    if not coords:
        connection.send_result(msg["id"],{"address":None})
        return
    lon,lat=gcj(*coords)
    cache=state.setdefault("address_cache",{})
    lock=state.setdefault("address_lock",asyncio.Lock())
    key=(entity,round(lon,5),round(lat,5))
    async with lock:
        # Snapshot the recording generation; removal/pause/re-add during HTTP
        # must never resurrect an address after the device's history was deleted.
        async with store.lock:
            if not store.active or not store.ready or entity not in store.managed or store.generations.get(entity,0)!=initial_generation:
                connection.send_result(msg["id"],{"address":None})
                return
            generation=await store.run(lambda c:c.execute("SELECT consent_at FROM probe_devices WHERE entity_id=?",(entity,)).fetchone())
            if not generation or ("recorded_at" not in msg and entity not in store.devices):
                connection.send_result(msg["id"],{"address":None})
                return
            generation=generation[0]
            if "recorded_at" in msg:
                exists=await store.run(lambda c:c.execute("SELECT 1 FROM probe_locations WHERE entity_id=? AND recorded_at=? AND recorded_at>=?",(entity,msg["recorded_at"],now_ms()-WINDOW)).fetchone())
                if not exists:
                    connection.send_result(msg["id"],{"address":None})
                    return
            now=now_ms()
            hit=cache.get(key)
            if hit and now-hit[0]<WINDOW:
                connection.send_result(msg["id"],{"address":hit[1]})
                return
            hit=await store.run(store.cached_address,entity,lon,lat)
            if hit:
                if len(cache)>=2048:
                    cache.pop(next(iter(cache)))
                cache[key]=(hit[2],hit[1])
                connection.send_result(msg["id"],{"address":hit[1]})
                return
        delay=max(0,1-(time.monotonic()-state.get("last_address_request",-1000)))
        if delay:
            await asyncio.sleep(delay)
        # Recheck authorization after rate-limit sleep, immediately before dispatch.
        async with store.lock:
            active=state.get("active")
            if not active or state.get("store") is not store or not store.active or not store.ready or entity not in store.managed or store.generations.get(entity,0)!=initial_generation:
                connection.send_result(msg["id"],{"address":None})
                return
            if "recorded_at" in msg:
                exists=await store.run(lambda c:c.execute("SELECT 1 FROM probe_locations WHERE entity_id=? AND recorded_at=? AND recorded_at>=?",(entity,msg["recorded_at"],now_ms()-WINDOW)).fetchone())
                if not exists:
                    connection.send_result(msg["id"],{"address":None})
                    return
            elif entity not in store.devices:
                connection.send_result(msg["id"],{"address":None})
                return
            if not store.active or not store.ready or state.get("store") is not store:
                connection.send_result(msg["id"],{"address":None})
                return
            service_key=active["service_key"]
        state["last_address_request"]=time.monotonic()
        address=None
        try:
            async with async_get_clientsession(hass).get("https://restapi.amap.com/v3/geocode/regeo",params={"key":service_key,"location":f"{lon:.6f},{lat:.6f}","extensions":"base"},timeout=10,allow_redirects=False) as resp:
                result=await resp.json(content_type=None)
                if result.get("status")=="1":
                    address=result.get("regeocode",{}).get("formatted_address")
        except Exception:
            pass
        async with store.lock:
            current=await store.run(lambda c:c.execute("SELECT consent_at FROM probe_devices WHERE entity_id=?",(entity,)).fetchone()) if store.active else None
            if not current or current[0]!=generation or store.generations.get(entity,0)!=initial_generation or not store.ready or entity not in store.managed or ("recorded_at" not in msg and entity not in store.devices):
                address=None
            if isinstance(address,str) and address:
                address=address[:1024]
                await store.run(store.save_address,entity,lon,lat,address)
                if len(cache)>=2048:
                    cache.pop(next(iter(cache)))
                cache[key]=(now_ms(),address)
        connection.send_result(msg["id"],{"address":address if isinstance(address,str) else None})

async def async_setup(hass, config):
    return True
async def async_setup_entry(hass, entry):
    state = hass.data.setdefault(DOMAIN,{})
    if not state.get("registered"):
        await hass.http.async_register_static_paths([StaticPathConfig("/luxe-location-probe-assets/panel.js", str(Path(__file__).parent / "panel.js"), False)])
        websocket_api.async_register_command(hass, ws_config)
        websocket_api.async_register_command(hass, ws_storage)
        websocket_api.async_register_command(hass, ws_history)
        websocket_api.async_register_command(hass, ws_address)
        hass.http.register_view(MapProxy())
        state["registered"] = True
    store = Store(hass)
    try:
        await store.start()
        state["store"] = store
        state["active"] = dict(entry.data)
        state["proxy_sessions"] = {}
        state["address_cache"] = {}
        await panel_custom.async_register_panel(hass, frontend_url_path=PANEL, webcomponent_name=PANEL, sidebar_title="位置中心", sidebar_icon="mdi:map-marker-radius-outline", module_url="/luxe-location-probe-assets/panel.js?v=0.1.20-preview", require_admin=True, embed_iframe=True)
    except BaseException:
        state.pop("active", None)
        state.pop("store", None)
        state.pop("proxy_sessions", None)
        state.pop("address_cache", None)
        try:
            frontend.async_remove_panel(hass, PANEL)
        except Exception:
            pass
        try:
            await store.stop()
        except Exception:
            _LOGGER.warning("Location setup rollback failed")
        raise
    return True
async def async_unload_entry(hass, entry):
    store = hass.data[DOMAIN].get("store")
    if store:
        store.active = False
        store.ready = False
    frontend.async_remove_panel(hass, PANEL)
    hass.data[DOMAIN].pop("active",None)
    hass.data[DOMAIN].pop("proxy_sessions",None)
    hass.data[DOMAIN].pop("address_cache",None)
    store = hass.data[DOMAIN].pop("store",None)
    if store:
        await store.stop()
    return True
