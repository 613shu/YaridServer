export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "EMAIL_EXISTS"
  | "STALL_LIMIT_REACHED"
  | "OPEN_LOAN_EXISTS"
  | "STOCK_NOT_EMPTY"
  | "STALL_TOO_NEW"
  | "DECORATION_EXISTS"
  | "PRODUCT_INACTIVE"
  | "LOAN_LIMIT_EXCEEDED"
  | "INSUFFICIENT_FUNDS"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  validation: (message = "Invalid input", details?: unknown) =>
    new AppError(400, "VALIDATION_ERROR", message, details),
  unauthorized: (message = "Missing or invalid token") => new AppError(401, "UNAUTHORIZED", message),
  forbidden: (message = "You are not allowed to do this") => new AppError(403, "FORBIDDEN", message),
  notFound: (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found`),
  conflict: (code: ErrorCode, message: string) => new AppError(409, code, message),
  insufficientFunds: (needed: number, balance: number) =>
    new AppError(422, "INSUFFICIENT_FUNDS", `Insufficient funds: need ${needed}, balance is ${balance}`, {
      needed,
      balance,
    }),
};
