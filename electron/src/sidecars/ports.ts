import net from "node:net";

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("freePort: server.address() did not return AddressInfo"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}
