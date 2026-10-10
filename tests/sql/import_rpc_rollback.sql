-- Import RPC assertions. Fresh fake space/users only; ALWAYS rolls back via the final RAISE.
-- Any failing ASSERT aborts with its message (different from 'ALL_ASSERTS_PASSED').
DO $$
DECLARE
  me uuid := gen_random_uuid(); pa uuid := gen_random_uuid(); sp uuid; sp2 uuid; w uuid; w2 uuid; w3 uuid;
  s1 uuid; s2 uuid; s3 uuid; a uuid; b uuid; c3 uuid; src uuid; src2 uuid; legacy uuid; r jsonb; t text; n int; failed boolean; tsa timestamptz; tsb timestamptz;
BEGIN
  INSERT INTO couple_spaces(name, created_by) VALUES ('t', me) RETURNING id INTO sp;
  INSERT INTO couple_spaces(name, created_by) VALUES ('t2', pa) RETURNING id INTO sp2;
  INSERT INTO space_members(space_id, user_id) VALUES (sp, me), (sp, pa);
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (sp, 'instagram', 'https://www.instagram.com/p/ZZtest1/', pa) RETURNING id INTO src;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  INSERT INTO import_sessions(space_id, created_by, origin, source_post_ids) VALUES (sp, me, 'manual', ARRAY[src]) RETURNING id INTO s1;
  INSERT INTO import_sessions(space_id, created_by, origin) VALUES (sp, me, 'manual') RETURNING id INTO s2;

  -- 1) A(fire) -> B(like); undo B while A saved => fire; undo A => nothing; work never deleted.
  INSERT INTO works(space_id, media_type, tmdb_id, title, created_by) VALUES (sp, 'movie', 999001, 'X', me) RETURNING id INTO w;
  INSERT INTO import_candidates(session_id, space_id, created_by, source_post_id, media_type, tmdb_id, title) VALUES (s1, sp, me, src, 'movie', 999001, 'X') RETURNING id INTO a;
  INSERT INTO import_candidates(session_id, space_id, created_by, media_type, tmdb_id, title) VALUES (s2, sp, me, 'movie', 999001, 'X') RETURNING id INTO b;
  r := import_confirm(a, w, 'fire', true); ASSERT r->>'indication' = 'created', 'A created';
  r := import_confirm(a, w, 'fire', true); ASSERT (r->>'idempotent')::boolean, 'confirm idempotent';
  r := import_confirm(b, w, 'like', false); ASSERT r->>'indication' = 'renewed', 'B renewed';
  ASSERT (SELECT reaction FROM interests WHERE work_id = w AND user_id = me) = 'like', 'B like applied';
  PERFORM import_undo(b);
  ASSERT (SELECT reaction FROM interests WHERE work_id = w AND user_id = me) = 'fire', 'undo B with A active -> fire';
  ASSERT (SELECT count(*) FROM indications WHERE work_id = w AND indicated_by = me) = 1, 'A keeps indication';
  ASSERT (SELECT count(*) FROM source_post_works WHERE work_id = w) = 1, 'A keeps its link';
  ASSERT (SELECT count(*) FROM prior_watch_status WHERE work_id = w AND watched) = 1, 'A keeps seen';
  r := import_undo(b); ASSERT (r->>'idempotent')::boolean, 'undo idempotent';
  PERFORM import_undo(a);
  ASSERT (SELECT count(*) FROM indications WHERE work_id = w) = 0, 'all undone: indication gone';
  ASSERT (SELECT count(*) FROM interests WHERE work_id = w) = 0, 'all undone: interest gone';
  ASSERT (SELECT count(*) FROM prior_watch_status WHERE work_id = w) = 0, 'all undone: seen gone';
  ASSERT (SELECT count(*) FROM source_post_works WHERE work_id = w) = 0, 'all undone: import link gone';
  ASSERT (SELECT count(*) FROM works WHERE id = w) = 1, 'recent preexisting work NOT deleted';

  -- 2) Reverse order + set_reaction ordering: A fire, B like, set A->neutral (A most recent), undo A => like (B).
  PERFORM import_confirm(a, w, 'fire', false); PERFORM import_confirm(b, w, 'like', false);
  PERFORM import_set_reaction(a, 'neutral');
  ASSERT (SELECT reaction FROM interests WHERE work_id = w AND user_id = me) = 'neutral', 'set_reaction A';
  PERFORM import_undo(a);
  ASSERT (SELECT reaction FROM interests WHERE work_id = w AND user_id = me) = 'like', 'undo A after set -> B like';
  PERFORM import_set_reaction(b, 'fire');
  ASSERT (SELECT reaction FROM interests WHERE work_id = w AND user_id = me) = 'fire', 'set_reaction B';
  PERFORM import_undo(b);
  ASSERT (SELECT count(*) FROM interests WHERE work_id = w) = 0, 'reverse order all undone';

  -- 3) External edit wins: A fire, B like, manual neutral, undo B => stays neutral; undo A => stays neutral.
  PERFORM import_confirm(a, w, 'fire', false); PERFORM import_confirm(b, w, 'like', false);
  UPDATE interests SET reaction = 'neutral' WHERE work_id = w AND user_id = me;
  PERFORM import_undo(b);
  ASSERT (SELECT reaction FROM interests WHERE work_id = w AND user_id = me) = 'neutral', 'external edit kept (B undo)';
  PERFORM import_undo(a);
  ASSERT (SELECT reaction FROM interests WHERE work_id = w AND user_id = me) = 'neutral', 'external edit kept (A undo)';
  DELETE FROM interests WHERE work_id = w;

  -- 4) Preexisting personal data, partner, legacy link.
  INSERT INTO works(space_id, media_type, tmdb_id, title, created_by) VALUES (sp, 'tv', 999003, 'Z', me) RETURNING id INTO w2;
  INSERT INTO indications(space_id, work_id, indicated_by, renewed_at) VALUES (sp, w2, me, '2026-01-01');
  INSERT INTO indications(space_id, work_id, indicated_by) VALUES (sp, w2, pa);
  INSERT INTO interests(work_id, user_id, reaction) VALUES (w2, me, 'like');
  INSERT INTO source_post_works(space_id, source_post_id, work_id, created_by) VALUES (sp, src, w2, pa);
  INSERT INTO import_candidates(session_id, space_id, created_by, source_post_id, media_type, tmdb_id, title) VALUES (s1, sp, me, src, 'tv', 999003, 'Z') RETURNING id INTO c3;
  r := import_confirm(c3, w2, 'fire', true); ASSERT r->>'indication' = 'renewed', 'preexisting renewed';
  PERFORM import_undo(c3);
  ASSERT (SELECT renewed_at::date FROM indications WHERE work_id = w2 AND indicated_by = me) = '2026-01-01', 'renewed_at restored';
  ASSERT (SELECT reaction FROM interests WHERE work_id = w2 AND user_id = me) = 'like', 'prior reaction restored';
  ASSERT (SELECT count(*) FROM indications WHERE work_id = w2 AND indicated_by = pa) = 1, 'partner indication kept';
  ASSERT (SELECT count(*) FROM source_post_works WHERE work_id = w2) = 1, 'legacy link kept';
  ASSERT (SELECT count(*) FROM prior_watch_status WHERE work_id = w2) = 0, 'seen restored to none';

  -- 5) Guards and completion.
  UPDATE import_candidates SET status = 'skipped' WHERE id = c3;
  failed := false; BEGIN PERFORM import_confirm(c3, w2, 'fire', false); EXCEPTION WHEN others THEN failed := SQLERRM = 'not_confirmable'; END; ASSERT failed, 'skipped not confirmable';
  failed := false; BEGIN PERFORM import_set_seen(c3, NULL); EXCEPTION WHEN others THEN failed := SQLERRM = 'invalid_seen'; END; ASSERT failed, 'null seen rejected';
  INSERT INTO import_sessions(space_id, created_by, origin, status) VALUES (sp, me, 'manual', 'needs_help') RETURNING id INTO s3;
  ASSERT import_complete(s3) = 'empty', 'empty session not completed';
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (sp, 'tiktok', 'https://vt.tiktok.com/ZZtest2/', me) RETURNING id INTO src2;
  UPDATE import_sessions SET source_post_ids = ARRAY[src2] WHERE id = s3;
  INSERT INTO import_candidates(session_id, space_id, created_by, media_type, tmdb_id, title, status) VALUES (s3, sp, me, 'movie', 999004, 'Q', 'skipped');
  ASSERT import_complete(s3) = 'sources_open', 'unanalysed source blocks';
  PERFORM import_skip_source(s3, src2, true);
  ASSERT import_complete(s3) = 'completed', 'explicit skip completes';
  failed := false; BEGIN DELETE FROM source_posts WHERE id = src; EXCEPTION WHEN others THEN failed := SQLERRM = 'source_in_open_session'; END; ASSERT failed, 'in-use source not deletable';
  DELETE FROM source_posts WHERE id = src2;
  ASSERT (SELECT cardinality(source_post_ids) FROM import_sessions WHERE id = s3) = 0, 'completed session array cleaned';

  -- 6) Partner and cross-space.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', pa, 'role', 'authenticated')::text, true);
  failed := false; BEGIN PERFORM import_undo(a); EXCEPTION WHEN others THEN failed := SQLERRM = 'forbidden'; END; ASSERT failed, 'partner cannot undo mine';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', me, 'role', 'authenticated')::text, true);
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (sp2, 'tiktok', 'https://vt.tiktok.com/ZZother/', pa) RETURNING id INTO legacy;
  failed := false; BEGIN INSERT INTO import_sessions(space_id, created_by, origin, source_post_ids) VALUES (sp, me, 'manual', ARRAY[legacy]); EXCEPTION WHEN others THEN failed := SQLERRM = 'source_space_mismatch'; END; ASSERT failed, 'cross-space session source';
  failed := false; BEGIN INSERT INTO import_candidates(session_id, space_id, created_by, source_post_id, media_type, tmdb_id, title) VALUES (s1, sp, me, legacy, 'movie', 1, 'x'); EXCEPTION WHEN foreign_key_violation THEN failed := true; END; ASSERT failed, 'cross-space candidate source';

  -- 7) Source identity + forged parameters.
  ASSERT import_source_for(sp, 'instagram', 'https://www.instagram.com/reel/ZZtest1/', 'ZZtest1', true) = src, 'reel reuses legacy /p/';
  ASSERT (SELECT source_url FROM source_posts WHERE id = src) = 'https://www.instagram.com/reel/ZZtest1/', 'legacy url corrected';
  ASSERT (SELECT created_by FROM source_posts WHERE id = src) = pa, 'legacy author kept';
  INSERT INTO source_posts(space_id, platform, source_url, created_by) VALUES (sp, 'instagram', 'https://www.instagram.com/p/ZZcar01/?img_index=4', pa) RETURNING id INTO legacy;
  ASSERT import_source_for(sp, 'instagram', 'https://www.instagram.com/p/ZZcar01/', 'ZZcar01', false) = legacy, 'carousel reuses img_index row';
  src2 := import_source_for(sp, 'instagram', 'https://www.instagram.com/reel/ZZnew01/', 'ZZnew01', true);
  ASSERT (SELECT source_url FROM source_posts WHERE id = src2) = 'https://www.instagram.com/reel/ZZnew01/', 'new reel stays /reel/';
  ASSERT import_source_for(sp, 'tiktok', 'https://www.tiktok.com/@a.b/video/7312345678901234567', NULL, false) IS NOT NULL, 'tiktok full ok';
  failed := false; BEGIN PERFORM import_source_for(sp, 'instagram', 'https://www.instagram.com/p/AAAAA/', 'ZZcar01', false); EXCEPTION WHEN others THEN failed := SQLERRM = 'source_params_mismatch'; END; ASSERT failed, 'forged shortcode';
  failed := false; BEGIN PERFORM import_source_for(sp, 'instagram', 'https://www.instagram.com/p/ZZtest1/', 'ZZtest1', true); EXCEPTION WHEN others THEN failed := SQLERRM = 'source_params_mismatch'; END; ASSERT failed, 'forged reel flag';
  failed := false; BEGIN PERFORM import_source_for(sp, 'instagram', 'https://vt.tiktok.com/ZZtest9/', NULL, false); EXCEPTION WHEN others THEN failed := SQLERRM = 'source_params_mismatch'; END; ASSERT failed, 'forged platform';
  failed := false; BEGIN PERFORM import_source_for(sp, 'tiktok', 'https://vt.tiktok.com/ZZtest9/', 'ZZtest1', false); EXCEPTION WHEN others THEN failed := SQLERRM = 'source_params_mismatch'; END; ASSERT failed, 'tiktok with shortcode';
  failed := false; BEGIN PERFORM import_source_for(sp, 'instagram', 'https://evil.com/p/AAAAA/', 'AAAAA', false); EXCEPTION WHEN others THEN failed := SQLERRM = 'invalid_source'; END; ASSERT failed, 'bad host';
  failed := false; BEGIN PERFORM import_source_for(sp, 'instagram', 'https://www.instagram.com/stories/AAAAA/', 'AAAAA', false); EXCEPTION WHEN others THEN failed := SQLERRM = 'invalid_source'; END; ASSERT failed, 'bad route';

  -- 8) renewed_at per decision. New indication: A creates (NULL), B renews (tsB); undo B => NULL; undo A => gone.
  INSERT INTO works(space_id, media_type, tmdb_id, title, created_by) VALUES (sp, 'movie', 999010, 'R', me) RETURNING id INTO w3;
  INSERT INTO import_candidates(session_id, space_id, created_by, media_type, tmdb_id, title) VALUES (s1, sp, me, 'movie', 999010, 'R') RETURNING id INTO a;
  INSERT INTO import_candidates(session_id, space_id, created_by, media_type, tmdb_id, title) VALUES (s2, sp, me, 'movie', 999010, 'R') RETURNING id INTO b;
  PERFORM import_confirm(a, w3, 'fire', false);
  ASSERT (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) IS NULL, 'A created: renewed_at NULL';
  PERFORM import_confirm(b, w3, 'like', false);
  tsb := (SELECT (effects->>'renewed_at')::timestamptz FROM import_candidates WHERE id = b);
  ASSERT tsb IS NOT NULL AND (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) = tsb, 'B renewed at its own ts';
  PERFORM import_set_reaction(a, 'neutral');
  ASSERT (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) = tsb, 'set_reaction does not touch renewal';
  PERFORM import_undo(b);
  ASSERT (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) IS NULL, 'undo B with A active -> NULL';
  PERFORM import_undo(a);
  ASSERT (SELECT count(*) FROM indications WHERE work_id = w3 AND indicated_by = me) = 0, 'undo A final -> indication gone';
  -- Order B->A on a new indication: undo A first keeps tsB; undo B final removes.
  PERFORM import_confirm(a, w3, 'fire', false); PERFORM import_confirm(b, w3, 'like', false);
  tsb := (SELECT (effects->>'renewed_at')::timestamptz FROM import_candidates WHERE id = b);
  PERFORM import_undo(a);
  ASSERT (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) = tsb, 'undo A first keeps tsB';
  PERFORM import_undo(b);
  ASSERT (SELECT count(*) FROM indications WHERE work_id = w3 AND indicated_by = me) = 0, 'undo B final -> gone';
  -- Preexisting indication (baseline 2026-01-01): A renews tsA, B renews tsB; undo B => tsA; undo A => baseline.
  INSERT INTO indications(space_id, work_id, indicated_by, renewed_at) VALUES (sp, w3, me, '2026-01-01 10:00+00');
  PERFORM import_confirm(a, w3, 'fire', false);
  tsa := (SELECT (effects->>'renewed_at')::timestamptz FROM import_candidates WHERE id = a);
  PERFORM import_confirm(b, w3, 'like', false);
  tsb := (SELECT (effects->>'renewed_at')::timestamptz FROM import_candidates WHERE id = b);
  ASSERT tsb > tsa, 'distinct ordered timestamps';
  PERFORM import_undo(b);
  ASSERT (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) = tsa, 'undo B -> tsA';
  PERFORM import_undo(a);
  ASSERT (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) = '2026-01-01 10:00+00', 'undo A -> baseline';
  -- External edit wins: A, B, manual renewed_at change, undo B keeps manual value.
  PERFORM import_confirm(a, w3, 'fire', false); PERFORM import_confirm(b, w3, 'like', false);
  UPDATE indications SET renewed_at = '2026-05-05 00:00+00' WHERE work_id = w3 AND indicated_by = me;
  PERFORM import_undo(b);
  ASSERT (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) = '2026-05-05 00:00+00', 'external renewed_at kept (B)';
  PERFORM import_undo(a);
  ASSERT (SELECT renewed_at FROM indications WHERE work_id = w3 AND indicated_by = me) = '2026-05-05 00:00+00', 'external renewed_at kept (A)';

  RAISE EXCEPTION 'ALL_ASSERTS_PASSED (rolled back)';
END $$;
