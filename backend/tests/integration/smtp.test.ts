import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { once } from "node:events";
import nodemailer from "nodemailer";
import { authMailer } from "../../src/auth/email";

test("Hostinger adapter delivers verification, recovery and invitations over real SMTP to an isolated loopback sink", async () => {
  const messages: string[] = [];
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost test SMTP\r\n");
    let buffer = "",
      data = false,
      message = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\r\n")) {
        const end = buffer.indexOf("\r\n"),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === ".") {
            messages.push(message);
            message = "";
            data = false;
            socket.write("250 queued\r\n");
          } else message += line + "\r\n";
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250 localhost\r\n");
        else if (/^MAIL FROM|^RCPT TO/.test(line)) socket.write("250 OK\r\n");
        else if (line === "DATA") {
          data = true;
          socket.write("354 End with dot\r\n");
        } else if (line === "QUIT") socket.end("221 Bye\r\n");
        else socket.write("500 Unexpected command\r\n");
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const mail = authMailer(
      {
        SMTP_USER: "support@example.test",
        SMTP_PASSWORD: "test-only-password",
        AUTH_EMAIL_FROM: "support@example.test",
        AUTH_BASE_URL: "http://localhost:3000",
      },
      (options) => {
        assert.equal(options.host, "smtp.hostinger.com");
        assert.equal(options.secure, true);
        assert.equal(options.requireTLS, true);
        // Only the injected test factory substitutes the loopback plaintext sink; production always verifies TLS.
        return nodemailer.createTransport({
          ...options,
          host: "127.0.0.1",
          port: address.port,
          secure: false,
          requireTLS: false,
          ignoreTLS: true,
          auth: undefined,
        });
      },
    )!;
    for (const kind of ["verify", "reset", "invite"] as const)
      await mail({
        kind,
        to: "recipient@example.test",
        url: "http://localhost:3000/workspace/login",
      });
    assert.equal(messages.length, 3);
    assert.match(messages[0], /Subject: Verify your StocksBuddha account/);
    assert.match(messages[1], /Subject: Reset your StocksBuddha password/);
    assert.match(messages[2], /Subject: Your organisation invitation/);
    for (const message of messages) {
      assert.match(message, /From: support@example.test/);
      assert.match(message, /To: recipient@example.test/);
      assert.match(message, /http:\/\/localhost:3000\/workspace\/login/);
      assert.doesNotMatch(message, /test-only-password/);
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});
