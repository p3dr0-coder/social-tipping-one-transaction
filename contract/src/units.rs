//! Float-free decimal parsing shared by every entry point that accepts an amount.
//!
//! NEP-141 transfers carry integer base units as base-10 strings. A tip preference is a
//! human-readable decimal that is only meaningful together with the decimals of the token
//! bound to this deployment, so parsing happens here, once, against those decimals.

/// The largest integer part accepted: with at most 24 token decimals this keeps every
/// intermediate value well inside `u128`.
const MAX_INTEGER_DIGITS: usize = 12;

fn parse_digits(digits: &str) -> u128 {
    digits.bytes().fold(0u128, |value, byte| {
        value
            .checked_mul(10)
            .and_then(|value| value.checked_add(u128::from(byte - b'0')))
            .expect("amount overflows u128")
    })
}

fn pow10(exponent: usize) -> u128 {
    (0..exponent).fold(1u128, |value, _| {
        value
            .checked_mul(10)
            .expect("decimals are too large for u128")
    })
}

/// Parses a decimal amount into integer base units.
///
/// Rules, applied in order: ASCII digits only, at most one dot, a non-empty integer part
/// without leading zeros, at most 12 integer digits, at most `decimals` fractional digits,
/// no trailing dot, and a value strictly greater than zero. No floating point is involved.
///
/// # Panics
///
/// Panics with a descriptive message when the input violates any rule or overflows `u128`.
pub fn parse_units(amount: &str, decimals: u8) -> u128 {
    let (integer, fraction) = amount.split_once('.').unwrap_or((amount, ""));

    assert!(!integer.is_empty(), "amount must have an integer part");
    assert!(
        integer.bytes().all(|byte| byte.is_ascii_digit()),
        "integer part must be ASCII digits"
    );
    assert!(
        integer == "0" || !integer.starts_with('0'),
        "amount must not have leading zeros"
    );
    assert!(
        integer.len() <= MAX_INTEGER_DIGITS,
        "integer part must be at most 12 digits"
    );
    assert!(
        fraction.bytes().all(|byte| byte.is_ascii_digit()),
        "fraction must be ASCII digits"
    );
    assert!(
        fraction.len() <= decimals as usize,
        "fraction has more digits than the bound token supports"
    );
    assert!(
        !amount.contains('.') || !fraction.is_empty(),
        "amount must not end with a dot"
    );

    let scale = pow10(decimals as usize);
    let integer_value = parse_digits(integer);
    let fraction_value = parse_digits(fraction)
        .checked_mul(pow10(decimals as usize - fraction.len()))
        .expect("amount overflows u128");
    let units = integer_value
        .checked_mul(scale)
        .and_then(|scaled| scaled.checked_add(fraction_value))
        .expect("amount overflows u128");

    assert!(units > 0, "amount must be greater than zero");
    units
}

#[cfg(test)]
mod tests {
    use super::parse_units;

    #[test]
    fn one_tenth_of_a_six_decimal_token() {
        assert_eq!(parse_units("0.1", 6), 100_000);
    }

    #[test]
    fn smallest_named_fraction_at_twenty_four_decimals() {
        assert_eq!(parse_units("0.0000001", 24), 100_000_000_000_000_000);
    }

    #[test]
    #[should_panic(expected = "fraction has more digits")]
    fn too_many_fractional_digits_panic() {
        parse_units("0.0000001", 6);
    }

    #[test]
    #[should_panic(expected = "leading zeros")]
    fn leading_zeros_panic() {
        parse_units("00.1", 6);
    }

    #[test]
    #[should_panic(expected = "must not end with a dot")]
    fn trailing_dot_panics() {
        parse_units("1.", 6);
    }

    #[test]
    fn twelve_integer_digits_at_zero_decimals_are_accepted() {
        assert_eq!(parse_units("500000000000", 0), 500_000_000_000);
    }

    #[test]
    #[should_panic(expected = "at most 12 digits")]
    fn thirteen_integer_digits_panic() {
        parse_units("1234567890123", 0);
    }

    #[test]
    #[should_panic(expected = "greater than zero")]
    fn zero_panics() {
        parse_units("0", 6);
    }

    #[test]
    #[should_panic(expected = "fraction has more digits")]
    fn fraction_with_zero_decimals_panics() {
        parse_units("1.0", 0);
    }

    #[test]
    fn integral_amount_scales_to_base_units() {
        assert_eq!(parse_units("12", 24), 12 * 10u128.pow(24));
    }

    #[test]
    #[should_panic(expected = "amount must have an integer part")]
    fn empty_amount_panics() {
        parse_units("", 6);
    }

    #[test]
    #[should_panic(expected = "amount must have an integer part")]
    fn lone_dot_panics() {
        parse_units(".", 6);
    }

    #[test]
    #[should_panic(expected = "amount must have an integer part")]
    fn missing_integer_part_panics() {
        parse_units(".5", 6);
    }

    #[test]
    #[should_panic(expected = "integer part must be ASCII digits")]
    fn negative_amount_panics() {
        parse_units("-1", 6);
    }

    #[test]
    #[should_panic(expected = "fraction must be ASCII digits")]
    fn second_dot_panics() {
        parse_units("1..2", 6);
    }

    #[test]
    #[should_panic(expected = "integer part must be ASCII digits")]
    fn non_digit_character_panics() {
        parse_units("1a", 6);
    }

    #[test]
    #[should_panic(expected = "greater than zero")]
    fn zero_integer_and_zero_fraction_panics() {
        parse_units("0.0", 6);
    }

    #[test]
    #[should_panic(expected = "decimals are too large for u128")]
    fn decimals_beyond_u128_pow10_overflow_panics() {
        parse_units("1", 39);
    }
}
