# Narrow error catches to expected error types

Never use a bare `catch { }` that swallows all exceptions when the
intent is to handle a specific failure class. Unexpected errors become
invisible, and the fallback path produces "successful" results with
silently wrong data.

## Rules

- Always capture the error variable: `catch (error)`.
- Check the error type or message before falling back. Use a type guard
  (e.g. `isYamlParseError`) to distinguish expected from unexpected errors.
- Re-throw anything that doesn't match the expected error shape.
- If the catch block returns a value, document what data may be missing
  compared to the happy path.

## Bad pattern

```typescript
try {
  const result = riskyParse(input);
} catch {
  return fallbackResult; // hides OOM, permission errors, etc.
}
```

## Good pattern

```typescript
try {
  const result = riskyParse(input);
} catch (error) {
  if (!isExpectedParseError(error)) throw error;
  return fallbackResult;
}
```
