// Hostinger's LiteSpeed launcher requires CommonJS; load the built ESM server asynchronously.
void import("./dist/main.js")
  .then(({ startServer }) => startServer())
  .catch((error) => {
    console.error("StocksBuddha startup failed", error);
    process.exitCode = 1;
  });
