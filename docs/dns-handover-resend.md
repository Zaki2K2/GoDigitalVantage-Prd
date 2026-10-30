# Resend DNS handover: mail.godigitalvantage.com

Add these records in the Cloudflare account where `godigitalvantage.com` is **Active**. Do not change registrar nameservers.

Authoritative nameservers: `naya.ns.cloudflare.com`, `piers.ns.cloudflare.com`.
Not authoritative: `henry`/`vita` (an inactive zone in the Syedzaki2kk2@gmail.com Cloudflare account; it holds copies of these records that have no effect).

| Type  | Name (no domain suffix)  | Content                                                                                                                                                                                                                                                                                   | Proxy    | TTL  |
| ----- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---- |
| TXT   | `resend._domainkey.mail` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC6QKdriHfLH4LdlrU6QWqHOsb4plMfl0tI18O+BalZ0NZHDirUx0oUbJh/1iiMZ+NEFhxc50K2BsiqelYT21O73TdOK+5W68EOnlOoa13rVfgZz0gnzTB4NPvWvzC6pmrAjpnNHGNqKix4imU7cmO/JhgNbu9ZCVq+hx7raHWOWQIDAQAB` (unquoted, one string) | n/a      | Auto |
| CNAME | `rsend.mail`             | `rsend-apne1.forge.rmta.net`                                                                                                                                                                                                                                                              | DNS only | Auto |
| CNAME | `send.mail`              | `send.forge.rmta.net`                                                                                                                                                                                                                                                                     | DNS only | Auto |

Add only these three. Leave existing website and `mxrouting` mail records untouched.

## Verification commands

Each should return the record (not "Non-existent domain") on every server:

```
for ns in naya.ns.cloudflare.com piers.ns.cloudflare.com 1.1.1.1 8.8.8.8; do
  nslookup -type=TXT   resend._domainkey.mail.godigitalvantage.com $ns
  nslookup -type=CNAME rsend.mail.godigitalvantage.com $ns
  nslookup -type=CNAME send.mail.godigitalvantage.com $ns
done
```

## After DNS resolves

1. Verify the domain in Resend until `verified` with sending enabled.
2. Signed webhook test (isolated test id).
3. One authorized test send.
4. Single Retry of the failed reward, then check status, webhook receipt and no duplicates.
5. Review production logs.

Already done: API redeployed with `RESEND_WEBHOOK_SECRET` set; Resend webhook points to `https://go-digital-vantage-prd.vercel.app/api/v1/webhooks/resend` (events delivered, failed, bounced, complained, suppressed).
