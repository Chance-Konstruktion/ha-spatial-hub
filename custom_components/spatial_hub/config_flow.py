"""Config flow -- one click, no questions.

The hub has nothing to configure: it discovers floors and areas from Home
Assistant and providers announce themselves. The options exist for users
who want to arrange every area by hand, or who bring their own renderer
and have no use for the built-in one.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, OptionsFlow

try:
    from homeassistant.config_entries import ConfigFlowResult
except ImportError:  # HA < 2024.4
    from homeassistant.data_entry_flow import FlowResult as ConfigFlowResult

from .const import (
    CONF_AUTO_AREAS,
    CONF_PANEL,
    DEFAULT_AUTO_AREAS,
    DEFAULT_PANEL,
    DOMAIN,
)


class SpatialHubConfigFlow(ConfigFlow, domain=DOMAIN):
    """Set up the hub. There is exactly one per Home Assistant."""

    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if self._async_current_entries():
            return self.async_abort(reason="single_instance_allowed")
        if user_input is not None:
            return self.async_create_entry(title="Spatial Hub", data={})
        return self.async_show_form(step_id="user", data_schema=vol.Schema({}))

    @staticmethod
    def async_get_options_flow(
        config_entry: ConfigEntry,
    ) -> "SpatialHubOptionsFlow":
        return SpatialHubOptionsFlow()


class SpatialHubOptionsFlow(OptionsFlow):
    """Hub options."""

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        options = self.config_entry.options
        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_AUTO_AREAS,
                        default=bool(options.get(CONF_AUTO_AREAS, DEFAULT_AUTO_AREAS)),
                    ): bool,
                    vol.Required(
                        CONF_PANEL,
                        default=bool(options.get(CONF_PANEL, DEFAULT_PANEL)),
                    ): bool,
                }
            ),
        )
