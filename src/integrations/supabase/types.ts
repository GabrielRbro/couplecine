export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_cache: {
        Row: {
          cache_key: string
          created_at: string
          feature: string
          id: string
          payload: Json
          user_id: string
        }
        Insert: {
          cache_key: string
          created_at?: string
          feature: string
          id?: string
          payload: Json
          user_id: string
        }
        Update: {
          cache_key?: string
          created_at?: string
          feature?: string
          id?: string
          payload?: Json
          user_id?: string
        }
        Relationships: []
      }
      authorized_users: {
        Row: {
          accepted_by: string | null
          created_at: string
          email: string
          id: string
          invited_by: string
          space_id: string
        }
        Insert: {
          accepted_by?: string | null
          created_at?: string
          email: string
          id?: string
          invited_by: string
          space_id: string
        }
        Update: {
          accepted_by?: string | null
          created_at?: string
          email?: string
          id?: string
          invited_by?: string
          space_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "authorized_users_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      couple_spaces: {
        Row: {
          created_at: string
          created_by: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          name?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      demo_batch_items: {
        Row: {
          batch: string
          created_at: string
          id: string
          match_session_id: string | null
          work_id: string | null
        }
        Insert: {
          batch: string
          created_at?: string
          id?: string
          match_session_id?: string | null
          work_id?: string | null
        }
        Update: {
          batch?: string
          created_at?: string
          id?: string
          match_session_id?: string | null
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "demo_batch_items_match_session_id_fkey"
            columns: ["match_session_id"]
            isOneToOne: false
            referencedRelation: "match_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demo_batch_items_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      discover_dismissals: {
        Row: {
          created_at: string
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          tmdb_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          media_type: Database["public"]["Enums"]["media_type"]
          tmdb_id: number
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
          tmdb_id?: number
          user_id?: string
        }
        Relationships: []
      }
      episode_cache: {
        Row: {
          air_date: string | null
          episode_number: number
          id: string
          name: string
          overview: string | null
          payload: Json
          runtime_minutes: number | null
          season_number: number
          still_path: string | null
          updated_at: string
          work_id: string
        }
        Insert: {
          air_date?: string | null
          episode_number: number
          id?: string
          name: string
          overview?: string | null
          payload?: Json
          runtime_minutes?: number | null
          season_number: number
          still_path?: string | null
          updated_at?: string
          work_id: string
        }
        Update: {
          air_date?: string | null
          episode_number?: number
          id?: string
          name?: string
          overview?: string | null
          payload?: Json
          runtime_minutes?: number | null
          season_number?: number
          still_path?: string | null
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "episode_cache_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      external_watch_items: {
        Row: {
          dated_episodes_count: number
          episodes: Json
          external_id: string
          external_type: string
          id: string
          imdb_id: string | null
          last_watched_at: string | null
          media_type: string | null
          provider: string
          status: string | null
          synced_at: string
          title: string
          tmdb_id: number | null
          total_episodes_count: number | null
          user_id: string
          user_rating: number | null
          watched_episodes_count: number | null
          year: number | null
        }
        Insert: {
          dated_episodes_count?: number
          episodes?: Json
          external_id: string
          external_type: string
          id?: string
          imdb_id?: string | null
          last_watched_at?: string | null
          media_type?: string | null
          provider: string
          status?: string | null
          synced_at?: string
          title: string
          tmdb_id?: number | null
          total_episodes_count?: number | null
          user_id: string
          user_rating?: number | null
          watched_episodes_count?: number | null
          year?: number | null
        }
        Update: {
          dated_episodes_count?: number
          episodes?: Json
          external_id?: string
          external_type?: string
          id?: string
          imdb_id?: string | null
          last_watched_at?: string | null
          media_type?: string | null
          provider?: string
          status?: string | null
          synced_at?: string
          title?: string
          tmdb_id?: number | null
          total_episodes_count?: number | null
          user_id?: string
          user_rating?: number | null
          watched_episodes_count?: number | null
          year?: number | null
        }
        Relationships: []
      }
      import_candidates: {
        Row: {
          backdrop_path: string | null
          corrected: boolean
          created_at: string
          created_by: string
          effects: Json
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          note: string | null
          original_title: string | null
          position: number
          poster_path: string | null
          reaction: Database["public"]["Enums"]["interest_reaction"] | null
          seen: boolean
          session_id: string
          source_post_id: string | null
          space_id: string
          status: string
          title: string
          tmdb_id: number
          updated_at: string
          work_id: string | null
          year: number | null
        }
        Insert: {
          backdrop_path?: string | null
          corrected?: boolean
          created_at?: string
          created_by: string
          effects?: Json
          id?: string
          media_type: Database["public"]["Enums"]["media_type"]
          note?: string | null
          original_title?: string | null
          position?: number
          poster_path?: string | null
          reaction?: Database["public"]["Enums"]["interest_reaction"] | null
          seen?: boolean
          session_id: string
          source_post_id?: string | null
          space_id: string
          status?: string
          title: string
          tmdb_id: number
          updated_at?: string
          work_id?: string | null
          year?: number | null
        }
        Update: {
          backdrop_path?: string | null
          corrected?: boolean
          created_at?: string
          created_by?: string
          effects?: Json
          id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
          note?: string | null
          original_title?: string | null
          position?: number
          poster_path?: string | null
          reaction?: Database["public"]["Enums"]["interest_reaction"] | null
          seen?: boolean
          session_id?: string
          source_post_id?: string | null
          space_id?: string
          status?: string
          title?: string
          tmdb_id?: number
          updated_at?: string
          work_id?: string | null
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "import_candidates_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "import_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "import_candidates_session_space_fk"
            columns: ["session_id", "space_id"]
            isOneToOne: false
            referencedRelation: "import_sessions"
            referencedColumns: ["id", "space_id"]
          },
          {
            foreignKeyName: "import_candidates_source_space_fk"
            columns: ["source_post_id", "space_id"]
            isOneToOne: false
            referencedRelation: "source_posts"
            referencedColumns: ["id", "space_id"]
          },
          {
            foreignKeyName: "import_candidates_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      import_sessions: {
        Row: {
          ai_done: boolean
          client_token: string | null
          created_at: string
          created_by: string
          id: string
          note: string | null
          origin: string
          shared_text: string | null
          shared_title: string | null
          shared_url: string | null
          skipped_source_ids: string[]
          source_post_ids: string[]
          space_id: string
          status: string
          updated_at: string
        }
        Insert: {
          ai_done?: boolean
          client_token?: string | null
          created_at?: string
          created_by: string
          id?: string
          note?: string | null
          origin: string
          shared_text?: string | null
          shared_title?: string | null
          shared_url?: string | null
          skipped_source_ids?: string[]
          source_post_ids?: string[]
          space_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          ai_done?: boolean
          client_token?: string | null
          created_at?: string
          created_by?: string
          id?: string
          note?: string | null
          origin?: string
          shared_text?: string | null
          shared_title?: string | null
          shared_url?: string | null
          skipped_source_ids?: string[]
          source_post_ids?: string[]
          space_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_sessions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      import_work_holds: {
        Row: {
          candidates: string[]
          import_reaction:
            | Database["public"]["Enums"]["interest_reaction"]
            | null
          import_renewed_at: string | null
          ind_existed: boolean
          prev_reaction: Database["public"]["Enums"]["interest_reaction"] | null
          prev_renewed_at: string | null
          prev_seen: boolean | null
          seen_baseline_recorded: boolean
          seen_candidates: string[]
          space_id: string
          user_id: string
          work_created: boolean
          work_id: string
        }
        Insert: {
          candidates?: string[]
          import_reaction?:
            | Database["public"]["Enums"]["interest_reaction"]
            | null
          import_renewed_at?: string | null
          ind_existed: boolean
          prev_reaction?:
            | Database["public"]["Enums"]["interest_reaction"]
            | null
          prev_renewed_at?: string | null
          prev_seen?: boolean | null
          seen_baseline_recorded?: boolean
          seen_candidates?: string[]
          space_id: string
          user_id: string
          work_created?: boolean
          work_id: string
        }
        Update: {
          candidates?: string[]
          import_reaction?:
            | Database["public"]["Enums"]["interest_reaction"]
            | null
          import_renewed_at?: string | null
          ind_existed?: boolean
          prev_reaction?:
            | Database["public"]["Enums"]["interest_reaction"]
            | null
          prev_renewed_at?: string | null
          prev_seen?: boolean | null
          seen_baseline_recorded?: boolean
          seen_candidates?: string[]
          space_id?: string
          user_id?: string
          work_created?: boolean
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "import_work_holds_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      indications: {
        Row: {
          created_at: string
          id: string
          indicated_by: string
          renewed_at: string | null
          space_id: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          indicated_by: string
          renewed_at?: string | null
          space_id: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          indicated_by?: string
          renewed_at?: string | null
          space_id?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "indications_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "indications_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_accounts: {
        Row: {
          external_account_id: string | null
          external_username: string | null
          id: string
          last_sync_at: string | null
          provider: string
          status: string
          sync_error: string | null
          sync_status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          external_account_id?: string | null
          external_username?: string | null
          id?: string
          last_sync_at?: string | null
          provider: string
          status?: string
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          external_account_id?: string | null
          external_username?: string | null
          id?: string
          last_sync_at?: string | null
          provider?: string
          status?: string
          sync_error?: string | null
          sync_status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      interests: {
        Row: {
          created_at: string
          id: string
          reaction: Database["public"]["Enums"]["interest_reaction"]
          updated_at: string
          user_id: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reaction: Database["public"]["Enums"]["interest_reaction"]
          updated_at?: string
          user_id: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reaction?: Database["public"]["Enums"]["interest_reaction"]
          updated_at?: string
          user_id?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "interests_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      joint_watch_sessions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          notes: string | null
          space_id: string
          watched_at: string
          work_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          notes?: string | null
          space_id: string
          watched_at?: string
          work_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          notes?: string | null
          space_id?: string
          watched_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "joint_watch_sessions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "joint_watch_sessions_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      match_participants: {
        Row: {
          card_limit: number
          close_requested: boolean
          extended_after_goal: boolean
          session_id: string
          user_id: string
        }
        Insert: {
          card_limit: number
          close_requested?: boolean
          extended_after_goal?: boolean
          session_id: string
          user_id: string
        }
        Update: {
          card_limit?: number
          close_requested?: boolean
          extended_after_goal?: boolean
          session_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_participants_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "match_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      match_sessions: {
        Row: {
          closed_at: string | null
          created_at: string
          created_by: string
          id: string
          result_work_ids: string[] | null
          space_id: string
          status: string
          work_ids: string[]
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          result_work_ids?: string[] | null
          space_id: string
          status?: string
          work_ids?: string[]
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          result_work_ids?: string[] | null
          space_id?: string
          status?: string
          work_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "match_sessions_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      match_votes: {
        Row: {
          created_at: string
          id: string
          liked: boolean
          session_id: string
          user_id: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          liked: boolean
          session_id: string
          user_id: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          liked?: boolean
          session_id?: string
          user_id?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "match_votes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "match_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "match_votes_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          id: string
          new_indication: boolean
          updated_at: string
          user_id: string
          watch_reminders: boolean
        }
        Insert: {
          id?: string
          new_indication?: boolean
          updated_at?: string
          user_id: string
          watch_reminders?: boolean
        }
        Update: {
          id?: string
          new_indication?: boolean
          updated_at?: string
          user_id?: string
          watch_reminders?: boolean
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          id: string
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      prior_watch_status: {
        Row: {
          id: string
          updated_at: string
          user_id: string
          watched: boolean
          work_id: string
        }
        Insert: {
          id?: string
          updated_at?: string
          user_id: string
          watched?: boolean
          work_id: string
        }
        Update: {
          id?: string
          updated_at?: string
          user_id?: string
          watched?: boolean
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prior_watch_status_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          created_at: string
          id: string
          score: number
          updated_at: string
          user_id: string
          work_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          score: number
          updated_at?: string
          user_id: string
          work_id: string
        }
        Update: {
          created_at?: string
          id?: string
          score?: number
          updated_at?: string
          user_id?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ratings_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      season_cache: {
        Row: {
          episode_count: number | null
          id: string
          name: string
          payload: Json
          poster_path: string | null
          season_number: number
          updated_at: string
          work_id: string
        }
        Insert: {
          episode_count?: number | null
          id?: string
          name: string
          payload?: Json
          poster_path?: string | null
          season_number: number
          updated_at?: string
          work_id: string
        }
        Update: {
          episode_count?: number | null
          id?: string
          name?: string
          payload?: Json
          poster_path?: string | null
          season_number?: number
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "season_cache_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      series_states: {
        Row: {
          id: string
          next_episode: number | null
          next_season: number | null
          space_id: string
          status: Database["public"]["Enums"]["series_status"]
          updated_at: string
          updated_by: string
          work_id: string
        }
        Insert: {
          id?: string
          next_episode?: number | null
          next_season?: number | null
          space_id: string
          status?: Database["public"]["Enums"]["series_status"]
          updated_at?: string
          updated_by: string
          work_id: string
        }
        Update: {
          id?: string
          next_episode?: number | null
          next_season?: number | null
          space_id?: string
          status?: Database["public"]["Enums"]["series_status"]
          updated_at?: string
          updated_by?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "series_states_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "series_states_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: true
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      source_post_works: {
        Row: {
          created_at: string
          created_by: string
          id: string
          source_post_id: string
          space_id: string
          via_import: boolean
          work_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          source_post_id: string
          space_id: string
          via_import?: boolean
          work_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          source_post_id?: string
          space_id?: string
          via_import?: boolean
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_post_works_source_post_id_space_id_fkey"
            columns: ["source_post_id", "space_id"]
            isOneToOne: false
            referencedRelation: "source_posts"
            referencedColumns: ["id", "space_id"]
          },
          {
            foreignKeyName: "source_post_works_work_id_space_id_fkey"
            columns: ["work_id", "space_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id", "space_id"]
          },
        ]
      }
      source_posts: {
        Row: {
          caption: string | null
          caption_fetched_at: string | null
          caption_status: string | null
          created_at: string
          created_by: string
          id: string
          platform: string
          source_url: string
          space_id: string
          work_id: string | null
        }
        Insert: {
          caption?: string | null
          caption_fetched_at?: string | null
          caption_status?: string | null
          created_at?: string
          created_by: string
          id?: string
          platform: string
          source_url: string
          space_id: string
          work_id?: string | null
        }
        Update: {
          caption?: string | null
          caption_fetched_at?: string | null
          caption_status?: string | null
          created_at?: string
          created_by?: string
          id?: string
          platform?: string
          source_url?: string
          space_id?: string
          work_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_posts_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_posts_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      space_members: {
        Row: {
          id: string
          joined_at: string
          space_id: string
          user_id: string
        }
        Insert: {
          id?: string
          joined_at?: string
          space_id: string
          user_id: string
        }
        Update: {
          id?: string
          joined_at?: string
          space_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "space_members_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      watch_events: {
        Row: {
          created_by: string
          episode_number: number | null
          id: string
          season_number: number | null
          session_id: string | null
          space_id: string
          watched_at: string
          work_id: string
        }
        Insert: {
          created_by: string
          episode_number?: number | null
          id?: string
          season_number?: number | null
          session_id?: string | null
          space_id: string
          watched_at?: string
          work_id: string
        }
        Update: {
          created_by?: string
          episode_number?: number | null
          id?: string
          season_number?: number | null
          session_id?: string | null
          space_id?: string
          watched_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watch_events_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "joint_watch_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_events_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watch_events_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      work_metadata_cache: {
        Row: {
          expires_at: string
          id: string
          payload: Json
          updated_at: string
          work_id: string
        }
        Insert: {
          expires_at: string
          id?: string
          payload?: Json
          updated_at?: string
          work_id: string
        }
        Update: {
          expires_at?: string
          id?: string
          payload?: Json
          updated_at?: string
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_metadata_cache_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: true
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
      works: {
        Row: {
          activity_at: string
          backdrop_path: string | null
          created_at: string
          created_by: string
          genres: string[]
          id: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_title: string | null
          overview: string | null
          poster_path: string | null
          release_year: number | null
          runtime_minutes: number | null
          space_id: string
          title: string
          tmdb_id: number
          updated_at: string
        }
        Insert: {
          activity_at?: string
          backdrop_path?: string | null
          created_at?: string
          created_by: string
          genres?: string[]
          id?: string
          media_type: Database["public"]["Enums"]["media_type"]
          original_title?: string | null
          overview?: string | null
          poster_path?: string | null
          release_year?: number | null
          runtime_minutes?: number | null
          space_id: string
          title: string
          tmdb_id: number
          updated_at?: string
        }
        Update: {
          activity_at?: string
          backdrop_path?: string | null
          created_at?: string
          created_by?: string
          genres?: string[]
          id?: string
          media_type?: Database["public"]["Enums"]["media_type"]
          original_title?: string | null
          overview?: string | null
          poster_path?: string | null
          release_year?: number | null
          runtime_minutes?: number | null
          space_id?: string
          title?: string
          tmdb_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "works_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "couple_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      work_watch_summary: {
        Row: {
          last_watched_at: string | null
          seen_count: number | null
          seen_keys: string[] | null
          work_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "watch_events_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "works"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ai_reserve: {
        Args: { _feature: string; _limit: number }
        Returns: boolean
      }
      app_secret_delete: { Args: { _name: string }; Returns: undefined }
      app_secret_get: { Args: { _name: string }; Returns: string }
      app_secret_set: {
        Args: { _by: string; _name: string; _value: string }
        Returns: undefined
      }
      can_create_space: { Args: never; Returns: boolean }
      demo_cleanup: { Args: { _batch: string }; Returns: number }
      import_complete: { Args: { _session: string }; Returns: string }
      import_confirm: {
        Args: {
          _candidate: string
          _reaction: Database["public"]["Enums"]["interest_reaction"]
          _seen: boolean
          _work: string
        }
        Returns: Json
      }
      import_dismiss: { Args: { _session: string }; Returns: undefined }
      import_set_reaction: {
        Args: {
          _candidate: string
          _reaction: Database["public"]["Enums"]["interest_reaction"]
        }
        Returns: undefined
      }
      import_set_seen: {
        Args: { _candidate: string; _seen: boolean }
        Returns: undefined
      }
      import_skip_source: {
        Args: { _session: string; _skip: boolean; _source: string }
        Returns: undefined
      }
      import_source_for: {
        Args: {
          _platform: string
          _reel: boolean
          _shortcode: string
          _space: string
          _url: string
        }
        Returns: string
      }
      import_undo: { Args: { _candidate: string }; Returns: Json }
      match_abandon: { Args: { _session: string }; Returns: undefined }
      match_extend: { Args: { _session: string }; Returns: number }
      match_join: { Args: { _session: string }; Returns: number }
      match_partner_wants_close: {
        Args: { _session: string }
        Returns: boolean
      }
      match_request_close: {
        Args: { _session: string; _want: boolean }
        Returns: string
      }
      match_undo: { Args: { _session: string }; Returns: string }
      set_episode_watched: {
        Args: {
          _episode: number
          _next_episode: number
          _next_season: number
          _season: number
          _watched: boolean
          _work: string
        }
        Returns: undefined
      }
      simkl_state_put: {
        Args: { _state: string; _user: string; _verifier: string }
        Returns: undefined
      }
      simkl_state_take: {
        Args: { _state: string }
        Returns: {
          user_id: string
          verifier: string
        }[]
      }
      simkl_sync_mark: {
        Args: { _attempt: boolean; _snapshot: Json; _user: string }
        Returns: undefined
      }
      simkl_token_delete: { Args: { _user: string }; Returns: undefined }
      simkl_token_get: {
        Args: { _user: string }
        Returns: {
          access_token: string
          expires_at: string
          last_sync_at: string
          refresh_token: string
          scope: string
          snapshot: Json
        }[]
      }
      simkl_token_set: {
        Args: {
          _access: string
          _expires: string
          _refresh: string
          _scope: string
          _user: string
        }
        Returns: undefined
      }
    }
    Enums: {
      interest_reaction: "fire" | "like" | "neutral" | "dislike"
      media_type: "movie" | "tv"
      series_status:
        | "watching"
        | "waiting"
        | "paused"
        | "abandoned"
        | "completed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      interest_reaction: ["fire", "like", "neutral", "dislike"],
      media_type: ["movie", "tv"],
      series_status: [
        "watching",
        "waiting",
        "paused",
        "abandoned",
        "completed",
      ],
    },
  },
} as const
