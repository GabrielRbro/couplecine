-- Transaction-reverted RPC test for import provenance (always rolls back via the final RAISE).
-- Run as a privileged role. Uses fresh fake space/users; never touches existing rows.
DO $$
DECLARE
  me uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); sp uuid; sp2 uuid; w uuid; w2 uuid;
  s1 uuid; s2 uuid; s3 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; src uuid; src2 uuid; legacy uuid; r jsonb; t text; n int; ok text := '';
BEGIN
  INSERT INTO couple_spaces(name, created_by) VALUES ('t', me) RETURNING id INTO sp;
  INSERT INTO couple_spaces(name, created_by) VALUES ('t2', pa) RETURNING id INTO sp2;
  INSERT INTO space_members(space_id, user_id) VALUES (sp, me), (sp, pa);
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (sp, 'instagram', 'https://www.instagram.com/p/ZZtest1/', pa) RETURNING id INTO src;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);

  -- T1: two sessions, same work; undo A then B; work created for the import is removed at the end.
  INSERT INTO works(space_id, media_type, tmdb_id, title, created_by) VALUES (sp, 'movie', 999001, 'X', me) RETURNING id INTO w;
  INSERT INTO import_sessions(space_id, created_by, origin, source_post_ids) VALUES (sp, me, 'manual', ARRAY[src]) RETURNING id INTO s1;
  INSERT INTO import_sessions(space_id, created_by, origin) VALUES (sp, me, 'manual') RETURNING id INTO s2;
  INSERT INTO import_candidates(session_id, space_id, created_by, source_post_id, media_type, tmdb_id, title) VALUES (s1, sp, me, src, 'movie', 999001, 'X') RETURNING id INTO c1;
  INSERT INTO import_candidates(session_id, space_id, created_by, media_type, tmdb_id, title) VALUES (s2, sp, me, 'movie', 999001, 'X') RETURNING id INTO c2;
  r := import_confirm(c1, w, 'fire', true);  ok := ok || ' | ' || coalesce((('T1 c1 '||(r->>'indication')))::text, 'NULL');
  r := import_confirm(c1, w, 'fire', true);  ok := ok || ' | ' || coalesce((('T1 c1 repeat idempotent='||(r->>'idempotent')))::text, 'NULL');
  r := import_confirm(c2, w, 'like', false); ok := ok || ' | ' || coalesce((('T1 c2 '||(r->>'indication')))::text, 'NULL');
  PERFORM import_undo(c1);
  SELECT count(*) INTO n FROM indications WHERE work_id = w AND indicated_by = me; ok := ok || ' | ' || coalesce((('T1 after undo c1 indications='||n))::text, 'NULL');
  SELECT count(*) INTO n FROM source_post_works WHERE work_id = w; ok := ok || ' | ' || coalesce((('T1 after undo c1 links='||n))::text, 'NULL');
  SELECT count(*) INTO n FROM prior_watch_status WHERE work_id = w; ok := ok || ' | ' || coalesce((('T1 after undo c1 seen rows='||n))::text, 'NULL');
  r := import_undo(c1); ok := ok || ' | ' || coalesce((('T1 undo c1 again idempotent='||(r->>'idempotent')))::text, 'NULL');
  PERFORM import_undo(c2);
  SELECT count(*) INTO n FROM indications WHERE work_id = w; ok := ok || ' | ' || coalesce((('T1 final indications='||n))::text, 'NULL');
  SELECT count(*) INTO n FROM interests WHERE work_id = w; ok := ok || ' | ' || coalesce((('T1 final interests='||n))::text, 'NULL');
  SELECT count(*) INTO n FROM works WHERE id = w; ok := ok || ' | ' || coalesce((('T1 final work rows='||n))::text, 'NULL');

  -- T2: reverse undo order (B then A).
  INSERT INTO works(space_id, media_type, tmdb_id, title, created_by) VALUES (sp, 'movie', 999002, 'Y', me) RETURNING id INTO w;
  INSERT INTO import_candidates(session_id, space_id, created_by, source_post_id, media_type, tmdb_id, title) VALUES (s1, sp, me, src, 'movie', 999002, 'Y') RETURNING id INTO c1;
  INSERT INTO import_candidates(session_id, space_id, created_by, media_type, tmdb_id, title) VALUES (s2, sp, me, 'movie', 999002, 'Y') RETURNING id INTO c2;
  PERFORM import_confirm(c1, w, 'fire', false); PERFORM import_confirm(c2, w, 'like', false);
  PERFORM import_undo(c2);
  SELECT count(*) INTO n FROM indications WHERE work_id = w; ok := ok || ' | ' || coalesce((('T2 after undo c2 indications='||n))::text, 'NULL');
  SELECT reaction::text INTO t FROM interests WHERE work_id = w; ok := ok || ' | ' || coalesce((('T2 after undo c2 reaction='||coalesce(t,'none')))::text, 'NULL');
  PERFORM import_undo(c1);
  SELECT count(*) INTO n FROM indications WHERE work_id = w; ok := ok || ' | ' || coalesce((('T2 final indications='||n))::text, 'NULL');
  SELECT count(*) INTO n FROM source_post_works WHERE work_id = w; ok := ok || ' | ' || coalesce((('T2 final links='||n))::text, 'NULL');
  SELECT count(*) INTO n FROM works WHERE id = w; ok := ok || ' | ' || coalesce((('T2 final work rows='||n))::text, 'NULL');

  -- T3: pre-existing personal data + legacy link + partner indication; personal edit after import wins.
  INSERT INTO works(space_id, media_type, tmdb_id, title, created_by, created_at) VALUES (sp, 'tv', 999003, 'Z', me, now() - interval '2 days') RETURNING id INTO w2;
  INSERT INTO indications(space_id, work_id, indicated_by, renewed_at) VALUES (sp, w2, me, '2026-01-01');
  INSERT INTO indications(space_id, work_id, indicated_by) VALUES (sp, w2, pa);
  INSERT INTO interests(work_id, user_id, reaction) VALUES (w2, me, 'like');
  INSERT INTO source_post_works(space_id, source_post_id, work_id, created_by) VALUES (sp, src, w2, pa);
  INSERT INTO import_candidates(session_id, space_id, created_by, source_post_id, media_type, tmdb_id, title) VALUES (s1, sp, me, src, 'tv', 999003, 'Z') RETURNING id INTO c3;
  r := import_confirm(c3, w2, 'fire', true); ok := ok || ' | ' || coalesce((('T3 '||(r->>'indication')))::text, 'NULL');
  UPDATE interests SET reaction = 'neutral' WHERE work_id = w2 AND user_id = me; -- edit outside import
  PERFORM import_undo(c3);
  SELECT renewed_at::date::text INTO t FROM indications WHERE work_id = w2 AND indicated_by = me; ok := ok || ' | ' || coalesce((('T3 my renewed_at restored='||coalesce(t,'deleted')))::text, 'NULL');
  SELECT count(*) INTO n FROM indications WHERE work_id = w2 AND indicated_by = pa; ok := ok || ' | ' || coalesce((('T3 partner indication='||n))::text, 'NULL');
  SELECT reaction::text INTO t FROM interests WHERE work_id = w2 AND user_id = me; ok := ok || ' | ' || coalesce((('T3 reaction kept outside edit='||t))::text, 'NULL');
  SELECT count(*) INTO n FROM prior_watch_status WHERE work_id = w2; ok := ok || ' | ' || coalesce((('T3 seen rows='||n))::text, 'NULL');
  SELECT count(*) INTO n FROM source_post_works WHERE work_id = w2; ok := ok || ' | ' || coalesce((('T3 legacy link='||n))::text, 'NULL');
  SELECT count(*) INTO n FROM works WHERE id = w2; ok := ok || ' | ' || coalesce((('T3 work kept='||n))::text, 'NULL');

  -- T4: status guards and completion rules.
  UPDATE import_candidates SET status = 'skipped' WHERE id = c3;
  BEGIN PERFORM import_confirm(c3, w2, 'fire', false); ok := ok || ' | ' || coalesce(('T4 skipped confirm ALLOWED(bad)')::text, 'NULL'); EXCEPTION WHEN others THEN ok := ok || ' | ' || coalesce((('T4 skipped confirm rejected: '||SQLERRM))::text, 'NULL'); END;
  BEGIN PERFORM import_set_seen(c3, NULL); ok := ok || ' | ' || coalesce(('T4 null seen ALLOWED(bad)')::text, 'NULL'); EXCEPTION WHEN others THEN ok := ok || ' | ' || coalesce((('T4 null seen rejected: '||SQLERRM))::text, 'NULL'); END;
  INSERT INTO import_sessions(space_id, created_by, origin, status) VALUES (sp, me, 'manual', 'needs_help') RETURNING id INTO s3;
  ok := ok || ' | ' || coalesce((('T4 complete empty='||import_complete(s3)))::text, 'NULL');
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (sp, 'tiktok', 'https://vt.tiktok.com/ZZtest2/', me) RETURNING id INTO src2;
  UPDATE import_sessions SET source_post_ids = ARRAY[src2] WHERE id = s3;
  INSERT INTO import_candidates(session_id, space_id, created_by, media_type, tmdb_id, title, status) VALUES (s3, sp, me, 'movie', 999004, 'Q', 'skipped') RETURNING id INTO c4;
  ok := ok || ' | ' || coalesce((('T4 complete with unanalysed source='||import_complete(s3)))::text, 'NULL');
  PERFORM import_skip_source(s3, src2, true);
  ok := ok || ' | ' || coalesce((('T4 complete after explicit skip='||import_complete(s3)))::text, 'NULL');
  BEGIN DELETE FROM source_posts WHERE id = src; ok := ok || ' | ' || coalesce(('T4 delete source in open session ALLOWED(bad)')::text, 'NULL'); EXCEPTION WHEN others THEN ok := ok || ' | ' || coalesce((('T4 delete in-use source rejected: '||SQLERRM))::text, 'NULL'); END;
  DELETE FROM source_posts WHERE id = src2;
  SELECT cardinality(source_post_ids) INTO n FROM import_sessions WHERE id = s3; ok := ok || ' | ' || coalesce((('T4 completed session array after delete='||n))::text, 'NULL');

  -- T5: partner cannot act on my candidate; cross-space source rejected.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  BEGIN PERFORM import_undo(c1); ok := ok || ' | ' || coalesce(('T5 partner undo ALLOWED(bad)')::text, 'NULL'); EXCEPTION WHEN others THEN ok := ok || ' | ' || coalesce((('T5 partner undo rejected: '||SQLERRM))::text, 'NULL'); END;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (sp2, 'tiktok', 'https://vt.tiktok.com/ZZother/', pa) RETURNING id INTO legacy;
  BEGIN INSERT INTO import_sessions(space_id, created_by, origin, source_post_ids) VALUES (sp, me, 'manual', ARRAY[legacy]); ok := ok || ' | ' || coalesce(('T5 cross-space source ALLOWED(bad)')::text, 'NULL'); EXCEPTION WHEN others THEN ok := ok || ' | ' || coalesce((('T5 cross-space session source rejected: '||SQLERRM))::text, 'NULL'); END;
  BEGIN INSERT INTO import_candidates(session_id, space_id, created_by, source_post_id, media_type, tmdb_id, title) VALUES (s1, sp, me, legacy, 'movie', 1, 'x'); ok := ok || ' | ' || coalesce(('T5 cross-space candidate ALLOWED(bad)')::text, 'NULL'); EXCEPTION WHEN others THEN ok := ok || ' | ' || coalesce(('T5 cross-space candidate rejected')::text, 'NULL'); END;

  -- T6: source identity. Partner's legacy /p/ row reused for my /reel/ share, URL corrected, author kept.
  ok := ok || ' | T6 reel reuses legacy=' || (import_source_for(sp, 'instagram', 'https://www.instagram.com/reel/ZZtest1/', 'ZZtest1', true) = src);
  SELECT source_url || ' partnerAuthor=' || (created_by = pa) INTO t FROM source_posts WHERE id = src; ok := ok || ' | T6 ' || t;
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (sp, 'instagram', 'https://www.instagram.com/p/ZZcar01/?img_index=4', pa) RETURNING id INTO legacy;
  ok := ok || ' | T6 carousel reuse=' || (import_source_for(sp, 'instagram', 'https://www.instagram.com/p/ZZcar01/', 'ZZcar01', false) = legacy);
  src2 := import_source_for(sp, 'instagram', 'https://www.instagram.com/reel/ZZnew01/', 'ZZnew01', true);
  SELECT source_url INTO t FROM source_posts WHERE id = src2; ok := ok || ' | T6 new reel=' || coalesce(t, 'NULL');
  BEGIN PERFORM import_source_for(sp, 'instagram', 'https://evil.com/p/x/', 'x', false); ok := ok || ' | T6 bad url ALLOWED(bad)'; EXCEPTION WHEN others THEN ok := ok || ' | T6 bad url rejected'; END;
  RAISE EXCEPTION 'ROLLBACK_RESULTS:%', ok;
END $$;
