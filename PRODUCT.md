# BUDX

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner uses BUDX to pose, record, and control a personal physical robot arm. Confirmed during project initialization.

## Product Purpose

Move a four-axis arm, inspect its pose in 3D, and save and replay movements.

## Operating Context

The existing browser application supports direct model dragging, sliders, keyboard input, a gamepad, Arduino USB serial, and local camera hand tracking. Motion recordings stay in this browser's local storage.

## Capabilities and Constraints

- Preserve the supplied CAD assembly, bearing alignment, joint limits, and recording format.
- Keep Stop and Home available while users hide or show the control panels.
- Fullscreen must also work in embedded browsers through a page-filling fallback.
- Camera and serial access require the browser's normal device permissions.
- The position-only Arduino protocol does not provide a hardware emergency stop.
- Physical device verification remains separate from browser simulation tests.

## Brand Commitments

The product name is BUDX. The owner requests a dark interface with glass controls, no branded top header or decorative logo, collapsible sidebars, dark CAD materials, interactive 3D snow, and a more widely spaced ground grid.

## Evidence on Hand

The repository contains the original CAD exports under public/models/, the controller and input modules under src/, and regression tests under tests/.

## Product Principles

- Give the arm and its movement the most space.
- Keep controls familiar and reveal secondary tools when needed.
- Preserve input ownership, cancellation, and joint limits when changing the interface.
- Respect system accessibility preferences and local appearance settings.
