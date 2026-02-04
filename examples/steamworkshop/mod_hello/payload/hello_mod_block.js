exports.main = async () => {
  const compute = (n) => n * n;
  const result = compute(3);

  let net = { ok: false, reasonCodes: ["CAP_NOT_GRANTED"] };
  if (typeof caps === "object" && caps && caps.net && typeof caps.net.fetch === "function") {
    try {
      net = await caps.net.fetch({ url: "/steam-hello" });
    } catch {
      net = { ok: false, reasonCodes: ["CAP_CALL_FAILED"] };
    }
  }

  return { ok: true, result, net };
};
