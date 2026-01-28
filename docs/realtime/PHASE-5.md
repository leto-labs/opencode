# Phase 5: Production Hardening

**Status: PARTIALLY COMPLETE** (Ephemeral keys done in Phase 3)

## PRD

Production-ready voice mode with proper security, error handling, and UX polish.

## Tasks

### Ephemeral Keys (DONE in Phase 3)
- [x] Session-scoped token generation
- [x] Server-side token caching with TTL
- [x] Token reuse within TTL window

### Remaining Work
- [ ] Token refresh on expiry (client-side)
- [ ] Graceful reconnection on token expiry
- [ ] Rate limiting token generation
- [ ] Connection error recovery
- [ ] Audio device selection UI
- [ ] Voice selection UI
- [ ] Connection quality indicator

## Token Lifecycle (Current)

```
1. Client requests: POST /session/:id/client_secret
2. Server checks cache:
   - If valid token exists → return cached token
   - If expired/missing → fetch from OpenAI, cache, return
3. Client connects to OpenAI with ephemeral token
4. Token expires after ~1 hour
5. [TODO] Client requests new token before expiry
```

## Future Enhancements

1. **Token refresh** - Proactively refresh before expiry
2. **Reconnection** - Auto-reconnect on disconnect with backoff
3. **Audio settings** - Device and voice selection
4. **Quality metrics** - Latency and connection quality display
