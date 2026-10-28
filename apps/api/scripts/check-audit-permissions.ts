/** Read-only: inspects the privileges of the connected MongoDB user. Performs no writes or deletes. */
import mongoose from 'mongoose';
import { connectDb } from '../src/db';
import { evaluateAuditPrivileges } from '../src/modules/admin/support-retention';
async function main() {
  const [database] = process.argv.slice(2);
  if (!database) throw new Error('Usage: npm run security:check-audit-permissions -- DATABASE');
  await connectDb();
  if (mongoose.connection.name !== database)
    throw new Error('Connected database does not match the explicit target');
  const status = await mongoose.connection.db!.admin().command({
    connectionStatus: 1,
    showPrivileges: true,
  });
  const info = status['authInfo'] as {
    authenticatedUsers: unknown[];
    authenticatedUserPrivileges?: {
      resource: { db?: string; collection?: string };
      actions: string[];
    }[];
  };
  if (!info.authenticatedUsers.length) {
    console.log(
      'UNVERIFIED: the connection is not authenticated (authorization disabled). Enable MongoDB authorization and a restricted application role before production.',
    );
    process.exitCode = 2;
    return;
  }
  const findings = evaluateAuditPrivileges(info.authenticatedUserPrivileges ?? [], database);
  if (findings.length) {
    findings.forEach((f) => console.log(`FAIL: ${f}`));
    process.exitCode = 1;
  } else console.log('OK: the application role can only append to support_access_log.');
}
main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Privilege check failed');
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
