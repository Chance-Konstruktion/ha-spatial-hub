"""Config flow -- one click, no questions.

The hub has nothing to configure: it discovers floors and areas from Home
Assistant and providers announce themselves. The single option exists for
users who want to arrange every area by hand.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow

try:
    from homeassistant.config_entries import ConfigFlowResult
except ImportError:  # HA < 2024.4
    from homeassistant.data_entry_flow import FlowResult as ConfigFlowResult

from .const import CONF_AUTO_AREAS, DEFAULT_AUTO_AREAS, DOMAIN


class FloorplanHubConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up the hub. There is exactly one per Home Assistant."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title="Floorplan-Hub", data={})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> "FloorplanHubOptionsFlow":
        return FloorplanHubOptionsFlow()


class FloorplanHubOptionsFlow(OptionsFlow):
    """Hub options."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = bool(
            self.config_entry.options.get(CONF_AUTO_AREAS, DEFAULT_AUTO_AREAS)
        )
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {vol.Required(CONF_AUTO_AREAS, default=current): bool}
            ),
        )
