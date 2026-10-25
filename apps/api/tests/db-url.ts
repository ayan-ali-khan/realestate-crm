// The test suite never touches dev data: it points at `<dbname>_test` on the
// same server. Pure helpers shared by global-setup and the worker env setup.
export function toTestDatabaseUrl(url: string): string {
  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, '');
  parsed.pathname = `/${dbName}_test`;
  return parsed.toString();
}

export function testDatabaseName(url: string): string {
  return `${new URL(url).pathname.replace(/^\//, '')}_test`;
}
