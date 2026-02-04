exports.main = async () => {
  const compute = (n) => n * n;
  const result = compute(7);

  let net = { ok: false, reasonCodes: ["CAP_NOT_GRANTED"] };
  if (typeof caps === "object" && caps && caps.net && typeof caps.net.fetch === "function") {
    try {
      net = await caps.net.fetch({ url: "/hello-mod" });
    } catch {
      net = { ok: false, reasonCodes: ["CAP_CALL_FAILED"] };
    }
  }

  return { ok: true, result, net };
};
