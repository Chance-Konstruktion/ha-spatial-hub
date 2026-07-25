"""Home Assistant stubs, injected before any hub code is imported.

Same approach as ha-powerline's test suite: enough of Home Assistant to
exercise the real logic, without installing Home Assistant.
"""

from __future__ import annotations

import sys
import types
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _module(name: str) -> types.ModuleType:
    if name not in sys.modules:
        mod = types.ModuleType(name)
        mod.__path__ = []
        sys.modules[name] = mod
    return sys.modules[name]


# -- homeassistant.core -------------------------------------------------------
_module("homeassistant")
core = _module("homeassistant.core")
if not hasattr(core, "HomeAssistant"):

    class HomeAssistant:  # pragma: no cover - a bag of data in tests
        def __init__(self) -> None:
            self.data: dict = {}

    core.HomeAssistant = HomeAssistant
    core.callback = lambda func: func

# -- homeassistant.config_entries ---------------------------------------------
config_entries = _module("homeassistant.config_entries")
if not hasattr(config_entries, "ConfigEntry"):
    config_entries.ConfigEntry = object

    class _Flow:
        def __init_subclass__(cls, **kwargs) -> None:  # domain=... kwarg
            super().__init_subclass__()

    config_entries.ConfigFlow = _Flow
    config_entries.OptionsFlow = _Flow
    config_entries.ConfigFlowResult = dict

# -- homeassistant.helpers.dispatcher -----------------------------------------
helpers = _module("homeassistant.helpers")
dispatcher = _module("homeassistant.helpers.dispatcher")
if not hasattr(dispatcher, "async_dispatcher_send"):
    _signals: dict = {}

    def async_dispatcher_connect(hass, signal, target):
        _signals.setdefault(id(hass), {}).setdefault(signal, []).append(target)

        def remove():
            _signals[id(hass)][signal].remove(target)

        return remove

    def async_dispatcher_send(hass, signal, *args):
        for target in list(_signals.get(id(hass), {}).get(signal, [])):
            target(*args)

    dispatcher.async_dispatcher_connect = async_dispatcher_connect
    dispatcher.async_dispatcher_send = async_dispatcher_send
    helpers.dispatcher = dispatcher

# -- homeassistant.helpers.storage --------------------------------------------
storage = _module("homeassistant.helpers.storage")
if not hasattr(storage, "Store"):

    class Store:
        """In-memory Store that records what would have been persisted."""

        def __init__(self, hass, version, key) -> None:
            self.hass, self.version, self.key = hass, version, key
            self.saved: dict | None = None
            self.preload: dict | None = None

        async def async_load(self):
            return self.preload

        def async_delay_save(self, data_func, delay=0):
            self.saved = data_func()

    storage.Store = Store
    helpers.storage = storage

# -- registries ---------------------------------------------------------------
area_registry = _module("homeassistant.helpers.area_registry")
floor_registry = _module("homeassistant.helpers.floor_registry")


class FakeArea:
    def __init__(self, area_id, name, floor_id=None, icon="") -> None:
        self.id, self.name, self.floor_id, self.icon = area_id, name, floor_id, icon


class FakeFloor:
    def __init__(self, floor_id, name, level=0, icon="") -> None:
        self.floor_id, self.name, self.level, self.icon = floor_id, name, level, icon


if not hasattr(area_registry, "async_get"):

    class _AreaRegistry:
        def __init__(self) -> None:
            self.areas: list[FakeArea] = []

        def async_list_areas(self):
            return self.areas

    class _FloorRegistry:
        def __init__(self) -> None:
            self.floors: list[FakeFloor] = []

        def async_list_floors(self):
            return self.floors

    def _area_get(hass):
        return hass.data.setdefault("_area_registry", _AreaRegistry())

    def _floor_get(hass):
        return hass.data.setdefault("_floor_registry", _FloorRegistry())

    area_registry.async_get = _area_get
    floor_registry.async_get = _floor_get
    helpers.area_registry = area_registry
    helpers.floor_registry = floor_registry

entity_registry = _module("homeassistant.helpers.entity_registry")
device_registry = _module("homeassistant.helpers.device_registry")


class FakeEntity:
    def __init__(self, entity_id, name=None, original_name=None, icon=None,
                 area_id=None, device_id=None) -> None:
        self.entity_id, self.name, self.original_name = entity_id, name, original_name
        self.icon, self.area_id, self.device_id = icon, area_id, device_id
        self.original_icon = None


class FakeDevice:
    def __init__(self, device_id, area_id=None) -> None:
        self.id, self.area_id = device_id, area_id


class FakeState:
    def __init__(self, state, **attributes) -> None:
        self.state, self.attributes = state, attributes


if not hasattr(entity_registry, "async_get"):

    class _EntityRegistry:
        def __init__(self) -> None:
            self.entities: dict[str, FakeEntity] = {}

        def async_get(self, entity_id):
            return self.entities.get(entity_id)

    class _DeviceRegistry:
        def __init__(self) -> None:
            self.devices: dict[str, FakeDevice] = {}

        def async_get(self, device_id):
            return self.devices.get(device_id)

    entity_registry.async_get = lambda hass: hass.data.setdefault(
        "_entity_registry", _EntityRegistry()
    )
    device_registry.async_get = lambda hass: hass.data.setdefault(
        "_device_registry", _DeviceRegistry()
    )
    helpers.entity_registry = entity_registry
    helpers.device_registry = device_registry


class FakeStates:
    """Stand-in for hass.states."""

    def __init__(self) -> None:
        self._states: dict[str, FakeState] = {}

    def set(self, entity_id, state, **attributes):
        self._states[entity_id] = FakeState(state, **attributes)

    def get(self, entity_id):
        return self._states.get(entity_id)


# -- homeassistant.components.websocket_api -----------------------------------
components = _module("homeassistant.components")
websocket_api = _module("homeassistant.components.websocket_api")
if not hasattr(websocket_api, "websocket_command"):

    def websocket_command(schema):
        def decorator(func):
            func._ws_schema = schema
            return func

        return decorator

    def async_register_command(hass, command):
        hass.data.setdefault("_ws_commands", []).append(command)

    websocket_api.websocket_command = websocket_command
    websocket_api.async_register_command = async_register_command
    websocket_api.async_response = lambda func: func
    websocket_api.require_admin = lambda func: func
    websocket_api.event_message = lambda msg_id, event: {"id": msg_id,
                                                        "event": event}
    components.websocket_api = websocket_api


@pytest.fixture
def hass():
    """A bare Home Assistant stand-in with the registries wired up."""
    instance = core.HomeAssistant()
    instance.states = FakeStates()
    return instance


@pytest.fixture
def connection():
    """Records what the websocket layer sent back."""

    class Connection:
        def __init__(self) -> None:
            self.results: dict = {}
            self.errors: list = []
            self.messages: list = []
            self.subscriptions: dict = {}

        def send_result(self, msg_id, result=None):
            self.results[msg_id] = result

        def send_error(self, msg_id, code, message):
            self.errors.append((msg_id, code, message))

        def send_message(self, message):
            self.messages.append(message)

    return Connection()
