from pathlib import Path
import asyncio
import math
import logging
import json
import secrets
import time
from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from .location_store import now_ms, WINDOW
import voluptuous as vol
from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from .location_store import Store, position
from .history_logic import collapse_history
from . import security
_LOGGER = logging.getLogger(__name__)
DOMAIN = "luxe_location_probe"
PANEL = "luxe-location-probe"

def checked(fn):
    def validate(value):
        try:
            return fn(value)
        except ValueError as err:
            raise vol.Invalid(str(err)) from None
    return validate

async def current_admin(hass, connection):
    user = await hass.auth.async_get_user(connection.user.id)
    return bool(user and user.is_active and user.is_admin and connection.user.is_active and connection.user.is_admin)

def connection_admin(connection):
    return connection.user.is_active and connection.user.is_admin
@websocket_api.websocket_command({vol.Required("type"): DOMAIN + "/config",vol.Optional("renew_path"):checked(security.session_path)})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_config(hass, connection, msg):
    if not await current_admin(hass, connection):
        connection.send_error(msg["id"], "unauthorized", "Administrator required")
        return
    data = hass.data.get(DOMAIN, {}).get("active")
    if not data:
        connection.send_error(msg["id"], "not_loaded", "Probe not loaded")
        return
    state = hass.data[DOMAIN]
    sessions = state.get("proxy_sessions")
    if sessions is None:
        connection.send_error(msg["id"], "not_loaded", "Probe not loaded")
        return
    now = time.monotonic()
    renew=msg.get("renew_path","")
    if renew:
        prefix="/api/luxe_location/"
        suffix="/_AMapService"
        token=renew[len(prefix):-len(suffix)] if renew.startswith(prefix) and renew.endswith(suffix) else ""
        session=sessions.get(token)
        if not session or session["user"]!=connection.user.id or session["expires"]+86400<=now:
            connection.send_error(msg["id"],"session_expired","Map session expired; reload panel")
            return
        session["expires"]=now+43200
        connection.send_result(msg["id"],{"map_key":data["map_key"],"proxy_path":renew})
        return
    for token in list(sessions):
        if sessions[token]["expires"]+86400 <= now:
            sessions.pop(token)
    if len(sessions) >= 64:
        sessions.pop(next(iter(sessions)))
    token = secrets.token_urlsafe(32)
    sessions[token] = {"expires":now+43200,"times":[],"user":connection.user.id}
    connection.send_result(msg["id"], {"map_key":data["map_key"],"proxy_path":"/api/luxe_location/"+token+"/_AMapService"})
@websocket_api.websocket_command({vol.Required("type"): DOMAIN + "/storage", vol.Required("action"): vol.In(["list","enable","disable","add","remove"]), vol.Optional("entity_id"): checked(security.entity_id), vol.Optional("import_history", default=True): bool, vol.Optional("delete_history", default=False): bool, vol.Optional("include_position", default=False): bool, vol.Optional("include_storage", default=True): bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_storage(hass, connection, msg):
    if not await current_admin(hass, connection):
        connection.send_error(msg["id"], "unauthorized", "Administrator required")
        return
    store = hass.data.get(DOMAIN, {}).get("store")
    if not store or not store.ready or not store.active:
        connection.send_error(msg["id"], "not_loaded", "Storage not ready")
        return
    try:
        action = msg["action"]
        if action != "list" and not msg.get("entity_id"):
            raise ValueError("Device required")
        # Discovery is already scheduled every minute by Store.
        if action != "list":
            await store.discover()
        if not await current_admin(hass, connection) or not store.active or not store.ready:
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
        stats = await store.storage_stats() if msg["include_storage"] else None
        if not await current_admin(hass, connection) or not store.active or not store.ready or hass.data.get(DOMAIN,{}).get("store") is not store:
            connection.send_error(msg["id"], "not_loaded", "Storage not ready")
            return
        if not connection_admin(connection):
            connection.send_error(msg["id"], "unauthorized", "Administrator required")
            return
        devices = []
        for entity in sorted(store.managed | store.excluded):
            state = hass.states.get(entity)
            pos = position(state)
            item = {"entity_id":entity,"name":state.name if state else entity,
                "managed":entity in store.managed,"enabled":entity in store.devices,
                "available":pos is not None,"recording_generation":store.generations.get(entity,0)}
            if msg["include_position"] and entity in store.managed and entity in store.devices and pos is not None:
                item["position"] = {"latitude":pos[0],"longitude":pos[1],"accuracy":pos[2],
                    "updated_at":int(state.last_updated.timestamp()*1000)}
            devices.append(item)
        connection.send_result(msg["id"], {"candidates":devices, **({"storage":stats} if stats is not None else {})})
    except ValueError:
        connection.send_error(msg["id"], "invalid_device", "Invalid GPS device")
    except Exception:
        _LOGGER.warning("Location storage operation failed (no coordinates logged)")
        connection.send_error(msg["id"], "storage_failed", "Storage operation failed")

@websocket_api.websocket_command({vol.Required("type"): DOMAIN + "/history", vol.Required("entity_id"): checked(security.entity_id), vol.Required("start"): checked(security.timestamp), vol.Required("end"): checked(security.timestamp), vol.Optional("collapse_repeated", default=False): bool})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_history(hass, connection, msg):
    if not await current_admin(hass, connection):
        connection.send_error(msg["id"], "unauthorized", "Administrator required")
        return
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
        generation = store.generations.get(entity, 0)
        def read(con):
            sql = "SELECT recorded_at,latitude,longitude,accuracy FROM probe_locations WHERE entity_id=? AND recorded_at>=? AND recorded_at<? ORDER BY recorded_at"
            args = (entity,max(start,now_ms()-WINDOW),min(end,now_ms()+1))
            if msg["collapse_repeated"]:
                return collapse_history(con.execute(sql,args))
            rows = con.execute(sql+" LIMIT 10001",args).fetchall()
            return [dict(r) for r in rows[:10000]], 0, len(rows)>10000
        try:
            rows, hidden, truncated = await store.run(read)
        except Exception:
            _LOGGER.warning("Location history query failed (no coordinates logged)")
            connection.send_error(msg["id"], "history_failed", "History query failed")
            return
    if not await current_admin(hass, connection) or not store.active or not store.ready or hass.data.get(DOMAIN,{}).get("store") is not store or entity not in store.managed or store.generations.get(entity, 0) != generation:
        connection.send_error(msg["id"], "not_loaded", "Storage not ready")
        return
    connection.send_result(msg["id"], {"points":rows,"truncated":truncated,"collapsed":hidden})

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
        if state.get("active") is not data or state.get("proxy_sessions",{}).get(token) is not session or session["expires"] <= time.monotonic():
            raise web.HTTPUnauthorized()
        # Explicit endpoints only. No arbitrary upstream paths or redirect following.
        allowed = {"v4/map/styles":"https://webapi.amap.com/v4/map/styles",
                   "v3/log/init":"https://restapi.amap.com/v3/log/init"}
        target = allowed.get(path)
        if not target:
            raise web.HTTPForbidden()
        if len(request.query_string)>8192:
            raise web.HTTPBadRequest()
        runtime = state.get("proxy_runtime")
        if runtime is None:
            raise web.HTTPUnauthorized()
        params = [(k,v) for k,v in request.query.items() if k.lower() not in ("key","jscode")]
        params.extend([("key",data["map_key"]),("jscode",data["security_code"])])
        if not security.reserve_proxy(runtime, session, time.monotonic()):
            raise web.HTTPTooManyRequests(headers={"Retry-After":"5"})
        try:
            async with async_get_clientsession(hass).get(target,params=params,allow_redirects=False,timeout=15) as resp:
                if resp.status!=200:
                    return web.Response(status=502)
                content_type = resp.content_type
                if content_type not in ("application/json","application/javascript","text/javascript","application/x-javascript","text/plain","application/octet-stream"):
                    return web.Response(status=502)
                body = await security.read_limited(resp.content, 4*1024*1024)
                # Never forward a response reflecting the server-side security code.
                if data["security_code"] and data["security_code"].encode() in body:
                    return web.Response(status=502)
                user = await hass.auth.async_get_user(session["user"])
                if not user or not user.is_admin or not user.is_active:
                    raise web.HTTPForbidden()
                if state.get("active") is not data or state.get("proxy_runtime") is not runtime or state.get("proxy_sessions",{}).get(token) is not session or session["expires"] <= time.monotonic():
                    raise web.HTTPUnauthorized()
                return web.Response(body=body,content_type=content_type,headers={"Cache-Control":"no-store","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"})
        except web.HTTPException:
            raise
        except Exception:
            return web.Response(status=502)
        finally:
            runtime["inflight"] -= 1

@websocket_api.websocket_command({vol.Required("type"): DOMAIN+"/address",vol.Required("entity_id"):checked(security.entity_id),vol.Optional("recorded_at"):checked(security.timestamp),vol.Optional("expected_updated_at"):checked(security.timestamp),vol.Optional("expected_latitude"):checked(lambda v: security.coordinate(v,90)),vol.Optional("expected_longitude"):checked(lambda v: security.coordinate(v,180))})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_address(hass,connection,msg):
    if not await current_admin(hass, connection):
        connection.send_error(msg["id"], "unauthorized", "Administrator required")
        return
    state=hass.data.get(DOMAIN,{})
    store=state.get("store")
    entity=msg["entity_id"]
    snapshot={"expected_updated_at","expected_latitude","expected_longitude"}
    supplied=snapshot.intersection(msg)
    if supplied and (supplied != snapshot or "recorded_at" in msg):
        connection.send_error(msg["id"], "invalid_snapshot", "Invalid position snapshot")
        return
    if not store or not store.ready or not store.active or entity not in store.managed:
        connection.send_error(msg["id"],"invalid_device","Device not managed")
        return
    runtime=state.get("address_runtime")
    if not runtime:
        connection.send_result(msg["id"],{"address":None})
        return
    if runtime["pending"] >= 32:
        connection.send_error(msg["id"], "busy", "Address queue busy")
        return
    runtime["pending"] += 1
    try:
        await resolve_address(hass, connection, msg, state, store, entity, runtime)
    except Exception:
        _LOGGER.warning("Location address operation failed (no coordinates logged)")
        connection.send_error(msg["id"], "address_failed", "Address operation failed")
    finally:
        runtime["pending"] -= 1

async def resolve_address(hass, connection, msg, state, store, entity, runtime):
    def valid():
        return connection_admin(connection) and state.get("store") is store and state.get("address_runtime") is runtime and store.active and store.ready and entity in store.managed and store.generations.get(entity,0)==initial_generation and ("recorded_at" in msg or entity in store.devices)
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
            current_state=hass.states.get(entity)
            p=position(current_state) if entity in store.devices else None
            if p and ("expected_updated_at" in msg or "expected_latitude" in msg or "expected_longitude" in msg):
                if (msg.get("expected_updated_at")!=int(current_state.last_updated.timestamp()*1000) or msg.get("expected_latitude")!=p[0] or msg.get("expected_longitude")!=p[1]):
                    p=None
            coords=(p[1],p[0]) if p else None
    if not coords:
        connection.send_result(msg["id"],{"address":None})
        return
    lon,lat=gcj(*coords)
    cache=runtime["cache"]
    lock=runtime["lock"]
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
            if not await current_admin(hass, connection) or not valid():
                connection.send_result(msg["id"],{"address":None})
                return
            now=now_ms()
            hit=cache.get(key)
            if hit and now-hit[0]<(WINDOW if hit[1] else 30000):
                connection.send_result(msg["id"],{"address":hit[1]})
                return
            if hit:
                cache.pop(key,None)
            hit=await store.run(store.cached_address,entity,lon,lat)
            if not await current_admin(hass, connection) or not valid():
                connection.send_result(msg["id"],{"address":None})
                return
            if hit:
                if len(cache)>=2048:
                    cache.pop(next(iter(cache)))
                cache[key]=(hit[2],hit[1])
                connection.send_result(msg["id"],{"address":hit[1]})
                return
        delay=max(0,1-(time.monotonic()-runtime.get("last_request",-1000)))
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
            else:
                latest=position(hass.states.get(entity)) if entity in store.devices else None
                if not latest or (latest[1],latest[0])!=coords:
                    connection.send_result(msg["id"],{"address":None})
                    return
            if not await current_admin(hass, connection) or not valid():
                connection.send_result(msg["id"],{"address":None})
                return
            service_key=active["service_key"]
        runtime["last_request"]=time.monotonic()
        address=None
        try:
            async with async_get_clientsession(hass).get("https://restapi.amap.com/v3/geocode/regeo",params={"key":service_key,"location":f"{lon:.6f},{lat:.6f}","extensions":"base"},timeout=10,allow_redirects=False) as resp:
                result=json.loads(await security.read_limited(resp.content, 65536)) if resp.status==200 else {}
                if isinstance(result,dict) and result.get("status")=="1":
                    address=result.get("regeocode",{}).get("formatted_address")
        except Exception:
            pass
        async with store.lock:
            current=await store.run(lambda c:c.execute("SELECT consent_at FROM probe_devices WHERE entity_id=?",(entity,)).fetchone()) if store.active else None
            if not await current_admin(hass, connection) or not valid() or not current or current[0]!=generation or store.generations.get(entity,0)!=initial_generation or not store.ready or entity not in store.managed or ("recorded_at" not in msg and entity not in store.devices):
                address=None
            if valid() and "recorded_at" in msg:
                exists=await store.run(lambda c:c.execute("SELECT 1 FROM probe_locations WHERE entity_id=? AND recorded_at=? AND recorded_at>=?",(entity,msg["recorded_at"],now_ms()-WINDOW)).fetchone())
                if not exists or not valid():
                    connection.send_result(msg["id"],{"address":None})
                    return
            if isinstance(address,str) and address:
                address=address[:1024]
                await store.run(store.save_address,entity,lon,lat,address)
                if not valid():
                    address=None
                else:
                    if len(cache)>=2048:
                        cache.pop(next(iter(cache)))
                    cache[key]=(now_ms(),address)
            elif valid():
                # Brief, memory-only negative cache avoids repeating failed lookups.
                if len(cache)>=2048 and key not in cache:
                    cache.pop(next(iter(cache)))
                cache[key]=(now_ms(),None)
        authorized = await current_admin(hass, connection)
        connection.send_result(msg["id"],{"address":address if authorized and valid() and isinstance(address,str) else None})

async def async_setup(hass, config):
    return True
async def async_setup_entry(hass, entry):
    state = hass.data.setdefault(DOMAIN,{})
    registered = state.setdefault("registered_steps", set())
    if state.get("registered"):
        registered.update(("static","config","storage","history","address","proxy"))
    if "static" not in registered:
        await hass.http.async_register_static_paths([StaticPathConfig("/luxe-location-probe-assets/panel.js", str(Path(__file__).parent / "panel.js"), False)])
        registered.add("static")
    for name, command in (("config",ws_config),("storage",ws_storage),("history",ws_history),("address",ws_address)):
        if name not in registered:
            websocket_api.async_register_command(hass, command)
            registered.add(name)
    if "proxy" not in registered:
        hass.http.register_view(MapProxy())
        registered.add("proxy")
    state["registered"] = True
    store = Store(hass)
    try:
        await store.start()
        state["store"] = store
        state["active"] = dict(entry.data)
        state["proxy_sessions"] = {}
        state["proxy_runtime"] = {"times":[],"inflight":0}
        state["address_runtime"] = {"lock":asyncio.Lock(),"cache":{},"last_request":-1000,"pending":0}
        state["address_cache"] = state["address_runtime"]["cache"]
        await panel_custom.async_register_panel(hass, frontend_url_path=PANEL, webcomponent_name=PANEL, sidebar_title="位置中心", sidebar_icon="mdi:map-marker-radius-outline", module_url="/luxe-location-probe-assets/panel.js?v=0.1.43-preview", require_admin=True, embed_iframe=True)
    except BaseException:
        state.pop("active", None)
        state.pop("store", None)
        state.pop("proxy_sessions", None)
        state.pop("proxy_runtime", None)
        state.pop("address_cache", None)
        state.pop("address_runtime", None)
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
    try:
        frontend.async_remove_panel(hass, PANEL)
    except Exception:
        _LOGGER.warning("Location panel removal failed")
    hass.data[DOMAIN].pop("active",None)
    hass.data[DOMAIN].pop("proxy_sessions",None)
    hass.data[DOMAIN].pop("proxy_runtime",None)
    hass.data[DOMAIN].pop("address_cache",None)
    hass.data[DOMAIN].pop("address_runtime",None)
    store = hass.data[DOMAIN].pop("store",None)
    if store:
        await store.stop()
    return True
