export class SessionAuthError extends Error {
  code = "UNAUTHENTICATED";

  constructor(message = "UNAUTHENTICATED") {
    super(message);
    this.name = "SessionAuthError";
  }
}