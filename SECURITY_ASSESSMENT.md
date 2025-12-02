# 🔐 Security Assessment Report

**Target:** `https://sonicmarketindexer-production.up.railway.app`  
**Date:** December 2, 2025  
**Assessor:** HexStrike Security Scanner + Manual Testing

---

## 📊 Executive Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | 1 |
| 🟠 High | 2 |
| 🟡 Medium | 3 |
| 🔵 Low | 2 |
| ℹ️ Informational | 3 |

**Overall Risk Level:** ⚠️ **MEDIUM-HIGH**

---

## 🔴 Critical Findings

### 1. Prometheus Metrics Endpoint Publicly Exposed

**Endpoint:** `/metrics`  
**Risk:** Critical Information Disclosure

**Description:**  
The `/metrics` endpoint exposes detailed Prometheus metrics including:
- Internal database operation timings
- Service names and method calls
- Database table names (`trades.flush`, `platformStats.flush`, `dailyStats.flush`, etc.)
- Performance characteristics that could aid in timing attacks

**Evidence:**
```
ponder_database_method_duration_bucket{le="1",service="user",method="trades.findMany"} 139
ponder_database_method_duration_bucket{le="1",service="user",method="platformStats.flush"} 83
```

**Impact:**  
- Reveals internal architecture and database schema
- Can be used to profile the system for timing attacks
- Exposes service names that could indicate technology stack

**Recommendation:**  
- Block access to `/metrics` from public internet
- Use Railway private networking or authentication
- If metrics are needed externally, require authentication

---

## 🟠 High Severity Findings

### 2. GraphQL Introspection Enabled in Production

**Endpoint:** `/graphql`  
**Risk:** Schema Information Disclosure

**Description:**  
Full GraphQL schema introspection is enabled, allowing anyone to query the complete API schema including all types, fields, and query operations.

**Evidence:**
```bash
curl -X POST /graphql -d '{"query":"{ __schema { types { name } } }"}'
# Returns: polls, markets, trades, users, winnings, liquidityEvents, platformStats, dailyStats, hourlyStats
```

**Impact:**  
- Attackers can map the entire API surface
- Reveals all queryable data including potential sensitive fields
- Facilitates targeted attacks on specific endpoints

**Recommendation:**  
- Disable introspection in production: `introspection: false` in GraphQL config
- Use persisted queries if clients need schema information

---

### 3. Wide Open CORS Policy

**Header:** `Access-Control-Allow-Origin: *`

**Description:**  
The API allows requests from any origin, enabling any website to make authenticated requests to your API.

**Evidence:**
```http
HTTP/2 200 
access-control-allow-origin: *
```

**Impact:**  
- Any malicious website can make requests to your API
- Potential for cross-site data exfiltration
- Facilitates CSRF-like attacks

**Recommendation:**  
- Restrict to known frontend domains: `access-control-allow-origin: https://anymarket.io`
- Implement a whitelist of allowed origins

---

## 🟡 Medium Severity Findings

### 4. Missing Security Headers

**Missing Headers:**
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Content-Security-Policy`
- `Strict-Transport-Security`
- `X-XSS-Protection`

**Impact:**  
- Vulnerable to clickjacking attacks
- Potential MIME-type sniffing vulnerabilities

**Recommendation:**  
Add security headers via Railway configuration or middleware:
```javascript
response.headers.set('X-Content-Type-Options', 'nosniff');
response.headers.set('X-Frame-Options', 'DENY');
response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
```

---

### 5. GraphQL Error Messages Leak Field Names

**Description:**  
GraphQL error messages reveal valid field names through "Did you mean" suggestions.

**Evidence:**
```json
{
  "message": "Cannot query field \"totalTvl\" on type \"platformStats\". Did you mean \"totalFees\" or \"totalPolls\"?"
}
```

**Impact:**  
- Facilitates schema enumeration even without introspection
- Reveals internal naming conventions

**Recommendation:**  
- Disable field suggestions in production
- Return generic error messages

---

### 6. No Query Complexity Limits

**Description:**  
The GraphQL API allows arbitrarily large queries without complexity limits.

**Evidence:**
```bash
# Successfully retrieved 243 records with limit: 1000
curl -X POST /graphql -d '{"query":"{ pollss(limit: 1000) { items { id } } }"}'
```

**Impact:**  
- Potential for DoS through expensive queries
- Resource exhaustion attacks

**Recommendation:**  
- Implement query depth limiting (max depth: 5-7)
- Implement query complexity analysis
- Add rate limiting per IP/client

---

## 🔵 Low Severity Findings

### 7. Status Endpoint Exposes Internal State

**Endpoint:** `/status`

**Evidence:**
```json
{
  "sonic": {
    "block": {
      "timestamp": 1764684776,
      "number": 56948725
    },
    "ready": true
  }
}
```

**Impact:**  
- Reveals current indexed block number
- Could be used to time attacks during resyncs

**Recommendation:**  
- Consider requiring authentication for `/status`
- Or accept as informational if needed for monitoring

---

### 8. GraphQL Batch Query Alias Attack Possible

**Description:**  
The API allows multiple aliased queries in a single request, potentially enabling amplification attacks.

**Evidence:**
```graphql
{ 
  q1: pollss(limit: 100) { items { id } } 
  q2: pollss(limit: 100) { items { id } }
  # ... can add many more
}
```

**Recommendation:**  
- Limit the number of root-level queries per request
- Implement query complexity scoring

---

## ℹ️ Informational Findings

### 9. Public Data Exposure (Expected Behavior)

The following data is publicly queryable, which may be intentional:
- User wallet addresses (e.g., `0xb52a3f95cbebc844e3818852d1e2a56f1cd2d9b5`)
- Trading volumes and history
- Platform statistics ($1,041.31 total volume, 141 trades, 6 users)
- Transaction hashes

**Note:** This is likely expected for a blockchain indexer, but ensure this aligns with your privacy policy.

---

### 10. Read-Only API (Good)

✅ The GraphQL API correctly has no mutations exposed:
```json
{ "__schema": { "mutationType": null } }
```

This prevents write operations through the API.

---

### 11. SQL Injection Resilient

✅ SQL injection attempts returned generic errors without executing:
```json
{
  "message": "Unexpected error.",
  "extensions": { "code": "INTERNAL_SERVER_ERROR" }
}
```

The Ponder framework properly sanitizes inputs.

---

## 📋 Remediation Priority

| Priority | Finding | Effort |
|----------|---------|--------|
| 1 | Block /metrics endpoint | Low |
| 2 | Disable GraphQL introspection | Low |
| 3 | Restrict CORS origins | Low |
| 4 | Add security headers | Low |
| 5 | Implement query complexity limits | Medium |
| 6 | Sanitize GraphQL error messages | Medium |

---

## 🛠️ Quick Fixes

### 1. Protect /metrics endpoint

In your Railway configuration or add middleware:
```javascript
// Block metrics in production
app.use('/metrics', (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.METRICS_TOKEN}`) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});
```

### 2. Disable GraphQL Introspection

In Ponder's GraphQL configuration (if customizable):
```javascript
{
  introspection: process.env.NODE_ENV !== 'production'
}
```

### 3. Add Security Headers

Create a middleware or configure via Railway:
```javascript
const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'",
};
```

---

## 📝 Conclusion

The production indexer has several security concerns that should be addressed:

1. **Immediate Action Required:** Block the `/metrics` endpoint from public access
2. **High Priority:** Disable GraphQL introspection and fix CORS policy
3. **Medium Priority:** Add security headers and implement rate limiting

The good news is that the API is read-only, properly sanitizes inputs against SQL injection, and serves its purpose as a blockchain indexer. The exposed data (wallet addresses, trades) is inherently public blockchain data.

---

*Report generated by manual security assessment using browser tools and curl testing.*



