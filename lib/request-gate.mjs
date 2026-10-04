/** Prevent late file reads, validations, or builds from replacing a newer source. */
export class RequestGate {
  #version = 0;
  start() { return ++this.#version; }
  isCurrent(token) { return token === this.#version; }
}
