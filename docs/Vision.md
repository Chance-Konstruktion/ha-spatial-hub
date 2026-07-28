# FP-Hub Vision

## The Goal

FP-Hub should become the **default spatial interface for Home Assistant**.

The user should never have to build dashboards manually again.

Instead of creating Lovelace dashboards, YAML layouts or custom cards, the user simply installs FP-Hub and immediately receives a complete interactive visualization of the home.

The guiding principle is simple:

> **Install → Open → Everything is already there.**

No YAML.

No dashboard building.

No manual entity placement.

No documentation required.

---

# Philosophy

FP-Hub is **not another dashboard**.

FP-Hub is the spatial layer of Home Assistant.

Every integration may optionally provide spatial information.

FP-Hub organizes and visualizes that information inside one coherent interface.

Providers describe the world.

FP-Hub organizes it.

Renderers visualize it.

---

# Core Principles

## Automatic Discovery

Installing an integration should be enough.

Example:

```text
Install UniFi

↓

Install Zigbee2MQTT

↓

Install Powerline

↓

Install Shelly

↓

Install Matter

↓

Open FP-Hub

↓

Everything appears automatically.
```

No entity placement.

No dashboard creation.

No YAML.

No setup.

---

## One House. One Interface.

Instead of opening

- UniFi Dashboard
- Powerline Dashboard
- Shelly Dashboard
- Zigbee Dashboard
- Matter Dashboard

the user opens one interface.

Everything exists inside the same spatial model.

---

# The Sandwich View

The Sandwich View should become the primary representation of the home.

```
             ☁ Cloud

          Dachboden

            2. OG

            1. OG

🌳 Garden ─ EG ─ Garden 🌳

           Keller
```

The Garden is **not another floor**.

It surrounds the Ground Floor.

This allows natural placement of

- Front Garden
- Backyard
- Terrace
- Garage
- Driveway
- Carport
- Garden House
- Pool

without introducing artificial levels.

Virtual providers

- Cloud
- Internet
- VPN
- Online Services

appear above the roof.

---

# Building Alignment

Every floor should optionally expose its outer walls.

The editor should display these outlines across all floors.

This allows perfect alignment of

- Basement
- Ground Floor
- Upper Floors
- Attic

even if balconies, terraces or roof shapes differ.

The result should always look like one coherent building.

---

# The Editor

The editor is one of the most important parts of FP-Hub.

It must be

- simple enough for a child
- powerful enough for an enthusiast

The philosophy:

> **Easy to use. Difficult to outgrow.**

---

## Room Editing

Rooms should never require coordinates.

Everything is done by dragging.

Supported actions

- Move room
- Resize room
- Resize walls
- Resize corners
- Snap to Grid (optional)
- Undo
- Redo

No YAML.

No pixel values.

No configuration files.

---

## Device Placement

Devices can be freely positioned.

Icons remain attached to their spatial position.

Zooming must never scale icons incorrectly.

The user should always keep orientation.

---

# Visual Language

The objective is not to draw icons.

The objective is to visualize the state of the home.

---

## Lighting

Lights should illuminate rooms.

Not just change icon colors.

Features

- configurable light radius
- RGB color visualization
- brightness visualization
- warm/cold white visualization
- walls block light
- light stays inside rooms

A room should visually feel illuminated.

---

## Networking

Network providers should visualize

- signal quality
- link quality
- connection status
- traffic animation

Examples

- Powerline
- UniFi
- Thread
- Bluetooth
- Matter
- Zigbee
- Z-Wave

---

## Climate

Future possibilities

- temperature gradients
- humidity
- air quality
- ventilation

Everything represented spatially.

---

# Interaction

Interaction should stay extremely simple.

---

## Short Click

A short click executes the primary action.

Examples

- Toggle Light
- Toggle Switch
- Open Cover
- Activate Scene

No dialog should be required for common actions.

---

## Long Press

Holding an icon opens a centered modal.

The floorplan always remains visible behind it.

The modal should provide

- Current Status
- Important Values
- Home Assistant More Info
- Device Page
- Entity List
- Settings
- Provider Panel (iframe)

The iframe should always appear centered.

The user should never lose orientation.

---

# Provider Integration

Every provider should be able to contribute

- Nodes
- Edges
- Icons
- Colors
- Animations
- Custom Panels

without FP-Hub knowing the provider by name.

No provider-specific code belongs inside FP-Hub.

---

# SDK Philosophy

Providers describe reality.

Renderers decide how reality is displayed.

A provider should never care whether the renderer is

- SVG
- Canvas
- WebGL
- VR
- AR
- Mobile
- Desktop

One API.

Many visualizations.

---

# Design Goals

FP-Hub should feel

- fast
- modern
- spatial
- intuitive
- minimalistic

The first impression should always be

> "This is my home."

Not

> "This is another dashboard."

---

# User Experience Goal

A completely new Home Assistant user should experience something like this.

```text
Install FP-Hub

↓

Open Home Assistant

↓

Everything is already there.

↓

The house appears.

↓

Lights illuminate rooms.

↓

Network devices are connected.

↓

Garden surrounds the building.

↓

Cloud services float above the roof.

↓

Every device can immediately be controlled.
```

No dashboard.

No setup.

No manual placement.

---

# The "Wow" Moment

After only a few minutes the user should think

> "Wait... that's it?"

followed immediately by

> "Why wasn't Home Assistant always like this?"

---

# Development Philosophy

Every proposed feature should answer one simple question.

> **Does this make the home easier to understand?**

If the answer is no,

it probably does not belong inside FP-Hub.

---

# Long-Term Vision

FP-Hub should eliminate the need for individual dashboards.

Every integration becomes spatially aware.

Every device appears naturally inside the home.

Developers no longer create dashboards.

They simply describe their devices.

FP-Hub does the rest.

---

# Success

FP-Hub succeeds when users stop thinking about dashboards.

Instead they simply open Home Assistant...

...and see their home.
