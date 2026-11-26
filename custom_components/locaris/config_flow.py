"""Initial setup and in-place credential reconfiguration."""
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import selector

DOMAIN = "locaris"
KEYS = ("map_key", "security_code", "service_key")

def credentials(user_input):
    if not isinstance(user_input, dict):
        return None
    data = {key: user_input.get(key) for key in KEYS}
    if not all(isinstance(value, str) and value.strip() for value in data.values()):
        return None
    return {key: value.strip() for key, value in data.items()}

def key_schema():
    return vol.Schema({
        vol.Required("map_key"): str,
        vol.Required("security_code"): selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
        vol.Required("service_key"): selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
    })

class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input=None):
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        data = credentials(user_input)
        if data is not None:
            return self.async_create_entry(title="Locaris", data=data)
        return self.async_show_form(step_id="user", errors={"base": "empty"} if user_input is not None else {}, data_schema=key_schema())

    async def async_step_reconfigure(self, user_input=None):
        entry = self._get_reconfigure_entry()
        data = credentials(user_input)
        if data is not None:
            return self.async_update_reload_and_abort(entry, data_updates=data, reason="reconfigure_successful")
        return self.async_show_form(step_id="reconfigure", errors={"base": "empty"} if user_input is not None else {}, data_schema=key_schema())
