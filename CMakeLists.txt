cmake_minimum_required(VERSION 3.16)
set(SDKCONFIG_DEFAULTS "${CMAKE_CURRENT_LIST_DIR}/config/esp32.defaults")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(RobotControlBoard)

# ArduinoBLE and Espressif's bundled BLE library both have BLEDevice.h.
# Prevent the bundled header from shadowing ArduinoBLE in this hybrid build.
idf_component_get_property(arduino_lib framework-arduinoespressif32 COMPONENT_LIB)
foreach(include_property INCLUDE_DIRECTORIES INTERFACE_INCLUDE_DIRECTORIES)
    get_target_property(arduino_includes ${arduino_lib} ${include_property})
    list(FILTER arduino_includes EXCLUDE REGEX "/libraries/BLE/src/?$")
    set_property(TARGET ${arduino_lib} PROPERTY ${include_property} "${arduino_includes}")
endforeach()
