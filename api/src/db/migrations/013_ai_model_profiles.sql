INSERT INTO settings(key,value,updated_at)
VALUES('ai_model_profile','gpt_5_6_sol',NOW())
ON CONFLICT(key) DO NOTHING;
