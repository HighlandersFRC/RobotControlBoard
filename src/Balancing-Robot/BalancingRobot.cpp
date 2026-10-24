#include <Arduino.h>
#include <PestoLink-Receive.h>
#include <Wire.h>
#include <math.h>

// LSM6DS3 at the requested I2C pins: SDA=GPIO 21, SCL=GPIO 22.
constexpr int IMU_SDA_PIN = 21;
constexpr int IMU_SCL_PIN = 22;
constexpr uint8_t IMU_ADDRESS_CANDIDATES[] = {0x6A, 0x6B};
constexpr uint8_t IMU_WHO_AM_I = 0x0F;
constexpr uint8_t IMU_CTRL1_XL = 0x10;
constexpr uint8_t IMU_CTRL2_G = 0x11;
constexpr uint8_t IMU_CTRL3_C = 0x12;
constexpr uint8_t IMU_OUTX_L_G = 0x22;
constexpr uint8_t IMU_OUTX_L_A = 0x28;
constexpr float ACCEL_G_PER_LSB = 0.000061f;  // +/-2 g
constexpr float GYRO_DPS_PER_LSB = 0.00875f;  // +/-245 degrees/s

// Robot Control Board motor outputs, same polarity and pins as Front-Loader.
constexpr int M1_EN_PIN = 18;
constexpr int M1_PH_PIN = 19;
constexpr int M2_EN_PIN = 16;
constexpr int M2_PH_PIN = 17;
constexpr int SLEEP_PIN = 23;

// Tune these after confirming the IMU axes and motor direction on the robot.
// The simulation uses these same gains, in degrees and degrees/second.
constexpr float KP = 0.035f;
constexpr float KI = 0.0005f;
constexpr float KD = 0.0045f;
constexpr float MAX_MOTOR_POWER = 0.65f;
constexpr float ARM_TILT_DEGREES = 8.0f;
constexpr float FALL_CUTOFF_DEGREES = 35.0f;
constexpr float ROLL_SIGN = 1.0f;
constexpr float GYRO_ROLL_SIGN = 1.0f;
constexpr uint32_t COMMAND_TIMEOUT_MS = 500;
constexpr uint32_t CONTROL_PERIOD_US = 5000;
constexpr uint32_t TELEMETRY_PERIOD_MS = 100;
constexpr float ROLL_FILTER_TIME_CONSTANT_SECONDS = 0.5f;

uint8_t imuAddress = 0;
bool imuReady = false;
bool pestoStarted = false;
bool connectedPreviously = false;
bool haveControllerPacket = false;
bool button0PreviouslyHeld = false;
bool balanceEnabled = false;
uint32_t lastControllerPacketMs = 0;
uint32_t lastControlUs = 0;
uint32_t lastTelemetryMs = 0;
float gyroXBiasDps = 0.0f;
float accelRollZeroDegrees = 0.0f;
float rollDegrees = 0.0f;
float rollRateDps = 0.0f;
float integralError = 0.0f;

bool writeRegister(uint8_t reg, uint8_t value) {
    Wire.beginTransmission(imuAddress);
    Wire.write(reg);
    Wire.write(value);
    return Wire.endTransmission() == 0;
}

bool readRegisters(uint8_t firstRegister, uint8_t *data, size_t count) {
    Wire.beginTransmission(imuAddress);
    Wire.write(firstRegister);
    if (Wire.endTransmission(false) != 0) return false;
    if (Wire.requestFrom(imuAddress, static_cast<uint8_t>(count)) != count) return false;
    for (size_t i = 0; i < count; ++i) data[i] = Wire.read();
    return true;
}

int16_t signedWord(const uint8_t *data, size_t offset) {
    return static_cast<int16_t>(static_cast<uint16_t>(data[offset]) |
                                (static_cast<uint16_t>(data[offset + 1]) << 8));
}

bool readImu(float &accelRoll, float &gyroX) {
    uint8_t accelData[6];
    uint8_t gyroData[6];
    if (!readRegisters(IMU_OUTX_L_A, accelData, sizeof(accelData)) ||
        !readRegisters(IMU_OUTX_L_G, gyroData, sizeof(gyroData))) return false;

    const float ay = signedWord(accelData, 2) * ACCEL_G_PER_LSB;
    const float az = signedWord(accelData, 4) * ACCEL_G_PER_LSB;
    // Roll is rotation about the IMU X axis: accel Y/Z estimate angle, gyro X gives rate.
    accelRoll = atan2f(ay, az) * RAD_TO_DEG;
    gyroX = signedWord(gyroData, 0) * GYRO_DPS_PER_LSB;
    return isfinite(accelRoll) && isfinite(gyroX);
}

bool initializeImu() {
    Wire.begin(IMU_SDA_PIN, IMU_SCL_PIN);
    Wire.setClock(400000);
    for (uint8_t candidate : IMU_ADDRESS_CANDIDATES) {
        imuAddress = candidate;
        uint8_t identity = 0;
        if (readRegisters(IMU_WHO_AM_I, &identity, 1) && identity == 0x6A) break;
        imuAddress = 0;
    }
    if (imuAddress == 0) return false;
    if (!writeRegister(IMU_CTRL3_C, 0x44) ||  // block update + register auto-increment
        !writeRegister(IMU_CTRL1_XL, 0x50) || // 104 Hz, +/-2 g
        !writeRegister(IMU_CTRL2_G, 0x50)) {  // 104 Hz, +/-245 dps
        return false;
    }
    delay(100);
    return true;
}

void driveMotor(int enablePin, int phasePin, float power) {
    power = constrain(power, -1.0f, 1.0f);
    if (power > 0.0f) {
        // Verified Robot Control Board output polarity: positive uses inverted PWM.
        analogWrite(enablePin, 255 - static_cast<int>(255.0f * power));
        digitalWrite(phasePin, HIGH);
    } else {
        analogWrite(enablePin, static_cast<int>(-255.0f * power));
        digitalWrite(phasePin, LOW);
    }
}

void stopMotors() {
    digitalWrite(SLEEP_PIN, LOW);
    driveMotor(M1_EN_PIN, M1_PH_PIN, 0.0f);
    driveMotor(M2_EN_PIN, M2_PH_PIN, 0.0f);
}

void setMotorPower(float power) {
    power = constrain(power, -MAX_MOTOR_POWER, MAX_MOTOR_POWER);
    driveMotor(M1_EN_PIN, M1_PH_PIN, power);
    driveMotor(M2_EN_PIN, M2_PH_PIN, power);
    digitalWrite(SLEEP_PIN, HIGH);
}

bool controllerFresh() {
    return PestoLink.isConnected() && haveControllerPacket &&
           (millis() - lastControllerPacketMs <= COMMAND_TIMEOUT_MS);
}

void calibrateImu() {
    Serial.println("Keep the robot upright and still: calibrating IMU for 2 seconds...");
    constexpr int SAMPLE_COUNT = 300;
    float rollSum = 0.0f;
    float gyroSum = 0.0f;
    int goodSamples = 0;
    for (int i = 0; i < SAMPLE_COUNT; ++i) {
        float accelRoll = 0.0f;
        float gyroX = 0.0f;
        if (readImu(accelRoll, gyroX)) {
            rollSum += accelRoll;
            gyroSum += gyroX;
            ++goodSamples;
        }
        delay(5);
    }
    if (goodSamples < SAMPLE_COUNT * 9 / 10) {
        imuReady = false;
        return;
    }
    accelRollZeroDegrees = rollSum / goodSamples;
    gyroXBiasDps = gyroSum / goodSamples;
    rollDegrees = 0.0f;
    rollRateDps = 0.0f;
    imuReady = true;
    Serial.printf("IMU calibrated: address=0x%02X roll-zero=%.2f gyro-Y-bias=%.2f dps\n",
                  imuAddress, accelRollZeroDegrees, gyroXBiasDps);
}

void setup() {
    Serial.begin(115200);
    pinMode(SLEEP_PIN, OUTPUT);
    pinMode(M1_EN_PIN, OUTPUT);
    pinMode(M1_PH_PIN, OUTPUT);
    pinMode(M2_EN_PIN, OUTPUT);
    pinMode(M2_PH_PIN, OUTPUT);
    stopMotors();

    imuReady = initializeImu();
    if (!imuReady) {
        Serial.println("LSM6DS3 not found. Check power, SDA=21, SCL=22, and address 0x6A/0x6B.");
    } else {
        calibrateImu();
    }

    pestoStarted = PestoLink.begin("BalanceBot");
    if (!pestoStarted) {
        Serial.println("PestoLink startup failed; motors remain disabled.");
        return;
    }
    Serial.println("PestoLink name: BalanceBot. Press button 0 to arm/disarm while upright.");
    Serial.println("Control: LSM6DS3 roll PID. Motors stop on disconnect, stale input, sensor error, or tip-over.");
    lastControlUs = micros();
}

void loop() {
    if (!pestoStarted || !imuReady) {
        stopMotors();
        delay(20);
        return;
    }

    if (CharacteristicGamepad.written()) {
        haveControllerPacket = CharacteristicGamepad.valueLength() == 18 &&
                               CharacteristicGamepad.value()[0] == 1;
        if (haveControllerPacket) lastControllerPacketMs = millis();
    }

    const bool connected = PestoLink.isConnected();
    if (connected != connectedPreviously) {
        Serial.println(connected ? "Controller connected." : "Controller disconnected; balancing disarmed.");
        connectedPreviously = connected;
        if (!connected) balanceEnabled = false;
    }
    if (!connected) haveControllerPacket = false;

    const bool fresh = controllerFresh();
    const bool button0Held = fresh && PestoLink.buttonHeld(0);
    if (!fresh) balanceEnabled = false;

    const uint32_t nowUs = micros();
    if (static_cast<uint32_t>(nowUs - lastControlUs) < CONTROL_PERIOD_US) {
        delay(1);
        return;
    }
    const float dt = constrain((nowUs - lastControlUs) * 1.0e-6f, 0.001f, 0.020f);
    lastControlUs = nowUs;

    float accelRoll = 0.0f;
    float gyroX = 0.0f;
    if (!readImu(accelRoll, gyroX)) {
        balanceEnabled = false;
        stopMotors();
        Serial.println("IMU read failed; balancing disarmed.");
        delay(10);
        return;
    }

    const float correctedGyro = (gyroX - gyroXBiasDps) * GYRO_ROLL_SIGN;
    const float correctedAccelRoll = (accelRoll - accelRollZeroDegrees) * ROLL_SIGN;
    rollRateDps = correctedGyro;
    // Complementary filter: gyro tracks quick motion; accelerometer corrects long-term drift.
    const float gyroWeight = ROLL_FILTER_TIME_CONSTANT_SECONDS /
                             (ROLL_FILTER_TIME_CONSTANT_SECONDS + dt);
    rollDegrees = gyroWeight * (rollDegrees + rollRateDps * dt) +
                  (1.0f - gyroWeight) * correctedAccelRoll;

    if (button0Held && !button0PreviouslyHeld) {
        if (balanceEnabled) {
            balanceEnabled = false;
            integralError = 0.0f;
            Serial.println("Balancing disarmed.");
        } else if (fabsf(rollDegrees) <= ARM_TILT_DEGREES) {
            balanceEnabled = true;
            integralError = 0.0f;
            Serial.println("Balancing armed. Keep a hand ready to catch the robot.");
        } else {
            Serial.printf("Cannot arm at %.1f degrees; stand the robot upright first.\n", rollDegrees);
        }
    }
    button0PreviouslyHeld = button0Held;

    float output = 0.0f;
    if (balanceEnabled && fresh) {
        const float error = rollDegrees; // target is calibrated upright (0 degrees)
        const float candidateIntegral = constrain(integralError + error * dt, -100.0f, 100.0f);
        const float requested = KP * error + KI * candidateIntegral + KD * rollRateDps;
        output = constrain(requested, -MAX_MOTOR_POWER, MAX_MOTOR_POWER);
        // Conditional integration limits wind-up when the motor output saturates.
        if (fabsf(requested) <= MAX_MOTOR_POWER || requested * error < 0.0f) {
            integralError = candidateIntegral;
        }
        if (fabsf(rollDegrees) >= FALL_CUTOFF_DEGREES) {
            balanceEnabled = false;
            integralError = 0.0f;
            Serial.println("Tip-over cutoff; balancing disarmed.");
        }
    }

    if (balanceEnabled && fresh) setMotorPower(output);
    else stopMotors();

    if (millis() - lastTelemetryMs >= TELEMETRY_PERIOD_MS) {
        Serial.printf("roll=%+.2f deg rate=%+.2f dps pid=%+.3f enabled=%d connected=%d\n",
                      rollDegrees, rollRateDps, output, balanceEnabled, connected);
        lastTelemetryMs = millis();
    }
}
