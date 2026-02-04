exports.main = async () => {
  await caps.net.fetch({ url: "https://example.invalid" });
  return { ok: true };
};
