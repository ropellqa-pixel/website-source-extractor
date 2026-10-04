-- Отметка «прочитано» для каждого пользователя отдельно: до какого момента он видел общий чат.
-- Программа АБИЗ и сайт больше не напоминают о сообщениях, которые человек уже открыл.
CREATE TABLE IF NOT EXISTS chat_reads (
  user_id text NOT NULL,
  room_id text NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, room_id)
);