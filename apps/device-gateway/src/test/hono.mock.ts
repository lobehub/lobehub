export class Hono {
  all() {
    return this;
  }

  fetch() {
    return new Response(null, { status: 404 });
  }

  post() {
    return this;
  }
}
