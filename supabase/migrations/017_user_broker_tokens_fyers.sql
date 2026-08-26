-- Allow Fyers alongside Upstox on user_broker_tokens.
ALTER TABLE public.user_broker_tokens
  DROP CONSTRAINT IF EXISTS user_broker_tokens_broker_check;

ALTER TABLE public.user_broker_tokens
  ADD CONSTRAINT user_broker_tokens_broker_check
  CHECK (broker IN ('upstox', 'fyers'));
