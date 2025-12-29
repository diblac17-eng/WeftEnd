/* src/ports/identity-port.ts */
/**
 * WeftEnd (WebLayers v2.6) — IdentityPort (interface only)
 *
 * Reserved capability family: id:present, id:sign, id:consent
 * Implementations may use passkeys / OS keystore / wallet / platform identity.
 *
 * Blocks never receive this port directly; runtime mediates access by plan+policy.
 */

import type {
  CapabilityError,
  IdConsentParams,
  IdConsentResponse,
  IdPresentParams,
  IdPresentResponse,
  IdSignParams,
  IdSignResponse,
  Result,
} from "../core/types";

export interface IdentityPort {
  present(params: IdPresentParams): Promise<Result<IdPresentResponse, CapabilityError>>;
  signChallenge(params: IdSignParams): Promise<Result<IdSignResponse, CapabilityError>>;
  consent(params: IdConsentParams): Promise<Result<IdConsentResponse, CapabilityError>>;
}