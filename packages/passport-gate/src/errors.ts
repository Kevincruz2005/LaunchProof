export type ValidationCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_LAUNCH_CONTRACT_URL"
  | "UNSAFE_LAUNCH_CONTRACT_URL"
  | "INVALID_FRESHNESS_THRESHOLDS"
  | "INVALID_PROVIDER_ADDRESS"
  | "INVALID_SOURCE_REVISION"
  | "INVALID_OBSERVED_AT";

export class PassportGateValidationError extends Error {
  constructor(
    public readonly code: ValidationCode,
    message: string,
  ) {
    super(message);
    this.name = "PassportGateValidationError";
  }
}
