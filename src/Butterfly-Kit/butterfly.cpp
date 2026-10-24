#include <Arduino.h>

// M1 runs continuously at a conservative fixed output; change this to tune speed.
constexpr int MOTOR_ONE_EN_PIN = 18;
constexpr int MOTOR_ONE_PH_PIN = 19;
constexpr int MOTOR_DRIVER_SLEEP_PIN = 23;
constexpr int MOTOR_POWER_PERCENT = 50;

void setup() {
    Serial.begin(115200);
    pinMode(MOTOR_DRIVER_SLEEP_PIN, OUTPUT);
    pinMode(MOTOR_ONE_EN_PIN, OUTPUT);
    pinMode(MOTOR_ONE_PH_PIN, OUTPUT);

    digitalWrite(MOTOR_DRIVER_SLEEP_PIN, LOW);
    digitalWrite(MOTOR_ONE_PH_PIN, HIGH);
    analogWrite(MOTOR_ONE_EN_PIN, 255 - (255 * MOTOR_POWER_PERCENT / 100));
    digitalWrite(MOTOR_DRIVER_SLEEP_PIN, HIGH);
    Serial.println("Butterfly: M1 running continuously at 50% power.");
}

void loop() {
    delay(1000);
}