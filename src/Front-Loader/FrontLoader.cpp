#include <Arduino.h>
#include <PestoLink-Receive.h>
#include <math.h>

// Motor pins and output formulas from RobotSampleCode.zip.
constexpr int M1_EN_PIN = 18;
constexpr int M1_PH_PIN = 19;
constexpr int M2_EN_PIN = 16;
constexpr int M2_PH_PIN = 17;
constexpr int SLEEP_PIN = 23;
constexpr int SERVO_PIN = 25;
constexpr uint8_t SERVO_PWM_CHANNEL = 0;
constexpr int SERVO_MIN_ANGLE = 0;
constexpr int SERVO_MAX_ANGLE = 180;
constexpr uint32_t SERVO_STEP_MS = 20;
constexpr int SERVO_DEGREES_PER_STEP = 4;

constexpr float JOYSTICK_DEADBAND = 0.08f;
constexpr float STEERING_DEADBAND = 0.15f;
constexpr float MAX_DRIVE_POWER = 1.0f;
// Reduce only the faster motor's scale if equal commands still drive unevenly.
constexpr float MOTOR_ONE_SCALE = 1.0f;
constexpr float MOTOR_TWO_SCALE = 1.0f;
constexpr bool INVERT_MOTOR_ONE = false;
constexpr bool INVERT_MOTOR_TWO = false;
constexpr uint32_t COMMAND_TIMEOUT_MS = 500;

static_assert(MOTOR_ONE_SCALE > 0.0f && MOTOR_ONE_SCALE <= 1.0f,
              "MOTOR_ONE_SCALE must be greater than 0 and at most 1");
static_assert(MOTOR_TWO_SCALE > 0.0f && MOTOR_TWO_SCALE <= 1.0f,
              "MOTOR_TWO_SCALE must be greater than 0 and at most 1");

bool button0WasHeld = false;
bool servoButtonWasHeld = false;
bool intakeIsDown = false;
bool previouslyConnected = false;
bool pestoStarted = false;
bool haveControllerPacket = false;
uint32_t lastControllerPacketMs = 0;
uint32_t lastServoStepMs = 0;
int servoAngle = SERVO_MAX_ANGLE;
int servoTargetAngle = SERVO_MAX_ANGLE;

void writeServoAngle(int angle) {
    // 50 Hz servo signal: 500 us at 0 degrees, 2400 us at 180 degrees.
    const uint32_t pulseUs = 500u + 1900u * static_cast<uint32_t>(angle) / 180u;
    const uint32_t duty = pulseUs * 65535u / 20000u;
    ledcWrite(SERVO_PWM_CHANNEL, duty);
}

float clampPower(float power) {
    return constrain(power, -1.0f, 1.0f);
}

float joystickAxis(uint8_t axis, float deadband) {
    float value = clampPower(PestoLink.getAxis(axis));
    if (fabsf(value) <= deadband) {
        return 0.0f;
    }
    // Keep full travel while removing the small movement around the center.
    float magnitude = (fabsf(value) - deadband) / (1.0f - deadband);
    return value < 0.0f ? -magnitude : magnitude;
}

void driveMotorOne(float power) {
    power = clampPower(INVERT_MOTOR_ONE ? -power : power);
    if (power > 0.0f) {
        // PH high with full PWM stopped both motors in testing; invert this duty.
        analogWrite(M1_EN_PIN, 255 - static_cast<int>(255.0f * power));
        digitalWrite(M1_PH_PIN, HIGH);
    } else {
        analogWrite(M1_EN_PIN, static_cast<int>(-255.0f * power));
        digitalWrite(M1_PH_PIN, LOW);
    }
}

void driveMotorTwo(float power) {
    power = clampPower(INVERT_MOTOR_TWO ? -power : power);
    if (power > 0.0f) {
        analogWrite(M2_EN_PIN, 255 - static_cast<int>(255.0f * power));
        digitalWrite(M2_PH_PIN, HIGH);
    } else {
        analogWrite(M2_EN_PIN, static_cast<int>(-255.0f * power));
        digitalWrite(M2_PH_PIN, LOW);
    }
}

void stopMotors() {
    digitalWrite(SLEEP_PIN, LOW);
    driveMotorOne(0.0f);
    driveMotorTwo(0.0f);
}

void setup() {
    Serial.begin(115200);
    pinMode(SLEEP_PIN, OUTPUT);
    digitalWrite(SLEEP_PIN, LOW);
    pinMode(M1_EN_PIN, OUTPUT);
    pinMode(M1_PH_PIN, OUTPUT);
    pinMode(M2_EN_PIN, OUTPUT);
    pinMode(M2_PH_PIN, OUTPUT);
    stopMotors();
    ledcSetup(SERVO_PWM_CHANNEL, 50, 16);
    ledcAttachPin(SERVO_PIN, SERVO_PWM_CHANNEL);
    writeServoAngle(servoAngle);

    pestoStarted = PestoLink.begin("robotikit");
    if (!pestoStarted) {
        Serial.println("PestoLink initialization failed.");
        return;
    }
    Serial.println("PestoLink started. Connect to robotikit in the iPhone app.");
    Serial.println("Joystick axes 0/1: forward/reverse and steering.");
    Serial.println("Press button 1 once to lower the intake; press it again to raise it.");
}

void loop() {
    if (!pestoStarted) {
        stopMotors();
        delay(1000);
        return;
    }

    // ArduinoBLE marks each incoming write, even if the stick hasn't moved.
    // The PestoLink background task handles BLE polling on the single CPU core.
    if (CharacteristicGamepad.written()) {
        haveControllerPacket = CharacteristicGamepad.valueLength() == 18 &&
                               CharacteristicGamepad.value()[0] == 1;
        if (haveControllerPacket) {
            lastControllerPacketMs = millis();
        }
    }

    bool connected = PestoLink.isConnected();
    if (connected != previouslyConnected) {
        Serial.println(connected ? "PestoLink controller connected." : "PestoLink controller disconnected.");
        previouslyConnected = connected;
    }

    if (!connected) {
        haveControllerPacket = false;
    }
    bool freshCommand = connected && haveControllerPacket &&
                        millis() - lastControllerPacketMs <= COMMAND_TIMEOUT_MS;

    float motorOne = 0.0f;
    float motorTwo = 0.0f;
    if (freshCommand) {
        // PestoLink axis 1 is negative when the joystick is pushed up.
        float throttle = -joystickAxis(1, JOYSTICK_DEADBAND);
        float steering = joystickAxis(0, STEERING_DEADBAND);
        // Preserve full turning power, with finer steering near the center.
        steering *= fabsf(steering);
        motorOne = throttle + steering;
        motorTwo = throttle - steering;
        float scale = fmaxf(1.0f, fmaxf(fabsf(motorOne), fabsf(motorTwo)));
        motorOne = motorOne / scale * MAX_DRIVE_POWER * MOTOR_ONE_SCALE;
        motorTwo = motorTwo / scale * MAX_DRIVE_POWER * MOTOR_TWO_SCALE;

        if (motorOne == 0.0f && motorTwo == 0.0f) {
            stopMotors();
        } else {
            driveMotorOne(motorOne);
            driveMotorTwo(motorTwo);
            digitalWrite(SLEEP_PIN, HIGH);
        }
    } else {
        stopMotors();
    }

    bool button0IsHeld = freshCommand && PestoLink.buttonHeld(0);

    if (button0IsHeld && !button0WasHeld) {
        Serial.printf("Requested power: M1=%.3f M2=%.3f\n", motorOne, motorTwo);
    }

    button0WasHeld = button0IsHeld;

    const bool servoButtonHeld = freshCommand && PestoLink.buttonHeld(1);
    if (servoButtonHeld && !servoButtonWasHeld) {
        intakeIsDown = !intakeIsDown;
        servoTargetAngle = intakeIsDown ? SERVO_MIN_ANGLE : SERVO_MAX_ANGLE;
        Serial.println(intakeIsDown ? "Intake moving down." : "Intake moving up.");
    }
    servoButtonWasHeld = servoButtonHeld;

    const uint32_t now = millis();
    if (servoAngle != servoTargetAngle && now - lastServoStepMs >= SERVO_STEP_MS) {
        const int direction = servoTargetAngle > servoAngle ? 1 : -1;
        servoAngle = constrain(servoAngle + direction * SERVO_DEGREES_PER_STEP,
                               SERVO_MIN_ANGLE, SERVO_MAX_ANGLE);
        if ((direction > 0 && servoAngle > servoTargetAngle) ||
            (direction < 0 && servoAngle < servoTargetAngle)) {
            servoAngle = servoTargetAngle;
        }
        writeServoAngle(servoAngle);
        lastServoStepMs = now;
    }
    delay(10);
}
