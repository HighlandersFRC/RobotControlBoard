import math

# Simplified inverted pendulum: theta_ddot = (g/L) sin(theta)
# - (wheel_accel/L) cos(theta) - damping * theta_dot.
DT = 0.005
DURATION = 5.0
G = 9.81
PENDULUM_LENGTH = 0.25
DAMPING = 0.35
MOTOR_ACCEL = 18.0  # m/s^2 at full command; assumed model parameter
MOTOR_TAU = 0.08
KP, KI, KD = 0.035, 0.0005, 0.0045  # output per degree, output/(degree s), output/(degree/s)
MAX_OUTPUT = 0.65


def run(initial_deg):
    theta = math.radians(initial_deg)
    rate = 0.0
    motor = 0.0
    integral = 0.0
    max_abs = abs(initial_deg)
    for _ in range(round(DURATION / DT)):
        deg = math.degrees(theta)
        rate_deg = math.degrees(rate)
        candidate_integral = max(-100.0, min(100.0, integral + deg * DT))
        raw = KP * deg + KI * candidate_integral + KD * rate_deg
        command = max(-MAX_OUTPUT, min(MAX_OUTPUT, raw))
        if abs(raw) <= MAX_OUTPUT or raw * deg < 0:
            integral = candidate_integral
        motor += (command - motor) * DT / MOTOR_TAU
        wheel_accel = MOTOR_ACCEL * motor
        acceleration = (G / PENDULUM_LENGTH) * math.sin(theta) - (wheel_accel / PENDULUM_LENGTH) * math.cos(theta) - DAMPING * rate
        rate += acceleration * DT
        theta += rate * DT
        max_abs = max(max_abs, abs(math.degrees(theta)))
    return math.degrees(theta), math.degrees(rate), max_abs

if __name__ == '__main__':
    print(f'assumptions: dt={DT}s duration={DURATION}s L={PENDULUM_LENGTH}m motor_accel={MOTOR_ACCEL}m/s^2 full command tau={MOTOR_TAU}s')
    print(f'PID: Kp={KP}, Ki={KI}, Kd={KD}, output_limit=+/-{MAX_OUTPUT}')
    for initial in (-10, -5, 5, 10):
        final_angle, final_rate, peak = run(initial)
        print(f'start={initial:+.1f} deg -> final={final_angle:+.3f} deg, rate={final_rate:+.3f} deg/s, peak={peak:.2f} deg')
