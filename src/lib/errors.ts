import i18next from "i18next";

const TRANSLATED_PREFIXES = [
  "password_required",
  "auth_failed",
  "connection_timeout",
  "ssh_connect_failed",
  "key_path_not_set",
  "key_passphrase_required",
  "key_passphrase_invalid",
  "key_parse_failed",
  "hardware_key_unsupported",
  "sftp_session_not_found",
  "session_not_found",
  "binary_file",
  "file_too_large",
  "mtime_conflict",
];

/**
 * Translate a backend error string into a user-facing message. Backend
 * errors are `code: details` (or a bare code); the code part is matched
 * against the errors.* i18n namespace, unknown codes fall back to the
 * generic message with the raw code appended for diagnostics.
 */
export function translateError(raw: string): string {
  const code = raw.split(":")[0].trim();
  if (TRANSLATED_PREFIXES.includes(code)) {
    return i18next.t(`errors.${code}`, { defaultValue: raw });
  }
  // mtime_conflict-style keys without a colon and multi-word codes
  if (i18next.exists(`errors.${code}`)) {
    return i18next.t(`errors.${code}`, { defaultValue: raw });
  }
  return `${i18next.t("errors.generic")}: ${raw}`;
}
