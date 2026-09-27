/** A returned tool failure remains a failure even when the tool did not throw. */
export function isToolResultSuccess(result) {
  return result != null && result.error == null && result.success !== false &&
    result.isError !== true && result.denied !== true && result.partial == null;
}
