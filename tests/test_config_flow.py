"""Exercise config flow methods with a small HA test double."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest

source = Path(__file__).resolve().parents[1] / "custom_components/locaris/config_flow.py"
nodes = [n for n in ast.parse(source.read_text()).body if not isinstance(n,(ast.Import,ast.ImportFrom))]
class FlowBase:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__()
    def _async_current_entries(self): return []
    def _get_reconfigure_entry(self): return self.entry
    def async_abort(self, **kw): return kw
    def async_create_entry(self, **kw): return kw
    def async_show_form(self, **kw): return kw
    def async_update_reload_and_abort(self, entry, **kw): return (entry, kw)
ns = {"config_entries":SimpleNamespace(ConfigFlow=FlowBase),
      "vol":SimpleNamespace(Schema=lambda x:x,Required=lambda x:x),
      "selector":SimpleNamespace(TextSelector=lambda x:x,TextSelectorConfig=lambda **kw:kw,TextSelectorType=SimpleNamespace(PASSWORD="password"))}
exec(compile(ast.Module(body=nodes,type_ignores=[]),str(source),"exec"),ns)
class ConfigFlowTest(unittest.IsolatedAsyncioTestCase):
    async def test_reconfigure_same_entry_and_reject_blank(self):
        flow=ns["ConfigFlow"]();flow.entry=object()
        result=await flow.async_step_reconfigure()
        self.assertEqual(result["step_id"],"reconfigure")
        self.assertEqual(result["errors"],{})
        result=await flow.async_step_reconfigure({"map_key":" ","security_code":"b","service_key":"c"})
        self.assertEqual(result["errors"],{"base":"empty"})
        entry,result=await flow.async_step_reconfigure({"map_key":" a ","security_code":"b","service_key":"c"})
        self.assertIs(entry,flow.entry)
        self.assertEqual(result["data_updates"],{"map_key":"a","security_code":"b","service_key":"c"})
        self.assertEqual(result["reason"],"reconfigure_successful")
    async def test_initial_entry_and_single_instance(self):
        flow=ns["ConfigFlow"]()
        self.assertEqual((await flow.async_step_user({"map_key":"a","security_code":"b","service_key":"c"}))["title"],"Locaris")
        flow._async_current_entries=lambda:[object()]
        self.assertEqual(await flow.async_step_user(),{"reason":"single_instance_allowed"})
