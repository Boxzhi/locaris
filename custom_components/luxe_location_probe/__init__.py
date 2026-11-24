from pathlib import Path
import voluptuous as vol
from homeassistant.components import frontend, panel_custom, websocket_api
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
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
    connection.send_result(msg["id"], {"map_key":data["map_key"], "security_code":data["security_code"]})
@websocket_api.websocket_command({vol.Required("type"): DOMAIN + "/geocode_test"})
@websocket_api.require_admin
@websocket_api.async_response
async def ws_geocode(hass, connection, msg):
    data = hass.data.get(DOMAIN, {}).get("active")
    if not data:
        connection.send_error(msg["id"], "not_loaded", "Probe not loaded")
        return
    try:
        async with async_get_clientsession(hass).get("https://restapi.amap.com/v3/geocode/regeo", params={"key":data["service_key"],"location":"116.397428,39.90923","extensions":"base"}, timeout=15) as resp:
            result = await resp.json(content_type=None)
            connection.send_result(msg["id"], {"http_status":resp.status,"status":result.get("status"),"infocode":result.get("infocode"),"info":result.get("info"),"address":result.get("regeocode",{}).get("formatted_address")})
    except Exception as err:
        connection.send_error(msg["id"], "request_failed", type(err).__name__)
async def async_setup(hass, config):
    return True
async def async_setup_entry(hass, entry):
    state = hass.data.setdefault(DOMAIN,{})
    if not state.get("registered"):
        await hass.http.async_register_static_paths([StaticPathConfig("/luxe-location-probe-assets/panel.js", str(Path(__file__).parent / "panel.js"), False)])
        websocket_api.async_register_command(hass, ws_config)
        websocket_api.async_register_command(hass, ws_geocode)
        state["registered"] = True
    state["active"] = dict(entry.data)
    await panel_custom.async_register_panel(hass, frontend_url_path=PANEL, webcomponent_name=PANEL, sidebar_title="位置地图测试", sidebar_icon="mdi:map-marker-radius-outline", module_url="/luxe-location-probe-assets/panel.js?v=0.0.3", require_admin=True, embed_iframe=True)
    return True
async def async_unload_entry(hass, entry):
    frontend.async_remove_panel(hass, PANEL)
    hass.data[DOMAIN].pop("active",None)
    return True
