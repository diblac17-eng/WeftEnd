The hard truth

Proxy runtime cannot stop a block from calling window.fetch unless you fully control evaluation and globals. It’s a convention, not enforcement.

Rewriting transforms help compatibility, but they’re bypassable unless you also prevent:

eval, Function, dynamic import tricks

indirect global access paths

libraries that stash references early

So if Strict means “cannot escape,” isolation is the anchor.

The winning structure
Strict Mode = Worker (or sandboxed iframe) + capability membrane

Rule: block code never runs in the page’s main global realm.

Run blocks in a Worker (or sandboxed iframe) with a minimal global surface.

All privileged operations go through:

message-passing to a host “kernel”

and the kernel checks the Ariadne string (planDigest + grants + evidence binding).

The worker never sees direct handles to fetch/storage/etc.

This is enforceable.

Cost: async boundary.
Reality: accept it as the price of actual containment. You can provide ergonomic wrappers, but you don’t pretend it’s sync.

Compatible Mode = Rewrite + Proxy, but labeled “ungoverned”

This is your migration path.

Rewriter converts common calls (fetch, localStorage, WebSocket) to gateway calls when it can.

Anything it can’t rewrite is either:

blocked (if you choose), or

allowed but stamped as UNGOVERNED_IO in the portal.

So compatibility doesn’t become a loophole. It becomes an honest downgrade.

Legacy Mode = observe only

Normal web app semantics. WeftEnd only reports.

The “scale” part: how you avoid interception whack-a-mole

Make the contract simple:

If you want Strict guarantees, your code must run in the Strict executor (Worker/iframe).
If it runs in the page realm, it’s not Strict—no matter what wrappers you provide.

That one rule prevents endless fights with browser APIs.

Recommended default for WeftEnd

Strict-by-default for third-party blocks (mods/plugins/market content): Worker isolation.

Compatible for first-party app glue (until migrated): rewrite + label.

Portal always tells the truth about which path a block took.

If you build it like this, “browser API interception” stops being the thing that kills you. It becomes a clear boundary: Strict has a real membrane; everything else is explicitly not Strict.

---

The sync I/O truth in Strict mode

If Strict runs in Workers, you lose sync I/O. That’s not a bug; it’s the cost of a real membrane.

1) Pure compute stays sync  
Anything that doesn’t need I/O remains synchronous and fast. Keep your heavy math here:

```
function compute(data) {
  return heavyPureMath(data);
}
```

2) I/O becomes explicit “prefetch, then compute”  
Pull data across the boundary first, then run compute on the prepared inputs.

Pattern:
- host/gateway fetches/storage-reads asynchronously
- passes bytes/value into the worker
- worker runs sync compute on that input

```ts
// host side (has governed caps)
const cache = await caps.storage.read("cacheKey");
worker.postMessage({ kind: "compute", cache });

// worker side (pure)
onmessage = (e) => {
  if (e.data.kind === "compute") {
    const result = compute(e.data.cache);
    postMessage({ kind: "result", result });
  }
};
```

The practical WeftEnd rule
- In Strict mode: No ambient sync I/O exists. If code assumes it, it’s not Strict-compatible.
- Migration path: make I/O explicit and move it to the governed boundary.

Long-term upside: This forces cleaner, testable shapes—pure compute units fed by explicit data—exactly what the DAG wants.
