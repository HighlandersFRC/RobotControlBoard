#include <Arduino.h>

// M1 and M2 run continuously at a conservative fixed output; change to tune speed.
constexpr int MOTOR_ONE_EN_PIN = 18;
constexpr int MOTOR_ONE_PH_PIN = 19;
constexpr int MOTOR_TWO_EN_PIN = 16;
constexpr int MOTOR_TWO_PH_PIN = 17;
constexpr int MOTOR_DRIVER_SLEEP_PIN = 23;
constexpr int MOTOR_POWER_PERCENT = 50;

void setup() {
    Serial.begin(115200);
    pinMode(MOTOR_DRIVER_SLEEP_PIN, OUTPUT);
    pinMode(MOTOR_ONE_EN_PIN, OUTPUT);
    pinMode(MOTOR_ONE_PH_PIN, OUTPUT);
    pinMode(MOTOR_TWO_EN_PIN, OUTPUT);
    pinMode(MOTOR_TWO_PH_PIN, OUTPUT);

    digitalWrite(MOTOR_DRIVER_SLEEP_PIN, LOW);
    digitalWrite(MOTOR_ONE_PH_PIN, HIGH);
    digitalWrite(MOTOR_TWO_PH_PIN, HIGH);
    const int pwm = 255 - (255 * MOTOR_POWER_PERCENT / 100);
    analogWrite(MOTOR_ONE_EN_PIN, pwm);
    analogWrite(MOTOR_TWO_EN_PIN, pwm);
    digitalWrite(MOTOR_DRIVER_SLEEP_PIN, HIGH);
    Serial.println("Dragon: M1 and M2 running continuously at 50% power.");
}

void loop() {
    delay(1000);
}