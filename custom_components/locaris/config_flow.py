import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers import selector
DOMAIN = "locaris"
LEGACY_DOMAIN = "luxe_location_probe"
class ConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1
    async def async_step_user(self, user_input=None):
        if self.hass.config_entries.async_entries(LEGACY_DOMAIN):
            return self.async_abort(reason="legacy_entry_exists")
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        errors = {}
        if user_input is not None:
            data = {k: v.strip() for k, v in user_input.items()}
            if all(data.values()):
                return self.async_create_entry(title="Locaris", data=data)
            errors["base"] = "empty"
        return self.async_show_form(step_id="user", errors=errors, data_schema=vol.Schema({
            vol.Required("map_key"): str,
            vol.Required("security_code"): selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
            vol.Required("service_key"): selector.TextSelector(selector.TextSelectorConfig(type=selector.TextSelectorType.PASSWORD)),
        }))
