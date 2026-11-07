/**
 * Accounts are switched off while email delivery is not set up. That covers
 * sign-in and sign-up, profiles, public deck pages with likes, comments and
 * follows, and syncing settings and pack data to an account. Everything else
 * keeps working from local storage. Set this to true to bring accounts back.
 */
export const ACCOUNTS_ENABLED = false
