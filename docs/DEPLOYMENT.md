# Cloudflare and website migration boundaries

No deployment has been performed. The checked-in Wrangler configuration is a
local-only template: placeholder D1 ID, no account ID, no routes, workers.dev
and preview URLs disabled. It must not be used against an existing account.

Before any deployment, obtain explicit confirmation from the user of the NEW
Cloudflare account ID and account name. Match both against the active account.
Never infer the new account from a saved login, previous projects, or DNS.

## Future separate staging step

1. Confirm the new account with the user.
2. Create a separate development Worker and D1 database in that account, with
   account and database IDs explicitly pinned in a separate reviewed config.
3. Keep model calls disabled; confirm free-tier quotas and actual pricing at
   deployment time. Local development has no hosted-service or model fees.
4. Replace the bootstrap bearer credential map with managed user login, tested
   membership roles, per-organisation quotas/rate limits, audit retention,
   secret rotation and a production operational review.
5. Apply migrations only to the newly confirmed staging database; test auth,
   isolation, bounded evaluation, approvals, persistence and failure handling.
6. Deploy only after the account and staging configuration are confirmed.

## Website migration remains a different change

The existing dist/ website and its old Cloudflare deployment are unchanged.
New UI output goes to build/web. Do not change existing Pages projects, DNS,
custom domains, redirects or account settings as part of this feature.

A later website migration needs its own PR, staging preview in the confirmed
account, route and asset inventory, accessibility/SEO checks, redirects, forms,
mobile tests and a rollback plan. Record the old deployment and DNS values;
test the replacement fully before requesting explicit cutover approval.
No cutover or old-account cleanup is authorised by this implementation.

## Platform references

- [Workers static asset bindings](https://developers.cloudflare.com/workers/static-assets/binding/)
- [D1 Worker API](https://developers.cloudflare.com/d1/worker-api/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

Cloudflare free allowances are finite, not a promise of unlimited free operation.
No deployment automation or paid service provisioning is included.

