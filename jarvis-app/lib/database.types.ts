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
      action_log: {
        Row: {
          action_type: string
          actor: string
          after_state: Json | null
          before_state: Json | null
          build_id: string | null
          cost_cents: number | null
          created_at: string
          error: string | null
          event_id: string | null
          external_ref: string | null
          id: string
          rule_id: string | null
          status: string
          summary: string
        }
        Insert: {
          action_type: string
          actor: string
          after_state?: Json | null
          before_state?: Json | null
          build_id?: string | null
          cost_cents?: number | null
          created_at?: string
          error?: string | null
          event_id?: string | null
          external_ref?: string | null
          id?: string
          rule_id?: string | null
          status: string
          summary: string
        }
        Update: {
          action_type?: string
          actor?: string
          after_state?: Json | null
          before_state?: Json | null
          build_id?: string | null
          cost_cents?: number | null
          created_at?: string
          error?: string | null
          event_id?: string | null
          external_ref?: string | null
          id?: string
          rule_id?: string | null
          status?: string
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "action_log_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_log_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "action_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_runs: {
        Row: {
          agent_id: string
          cost_cents: number | null
          error: string | null
          finished_at: string | null
          id: string
          input: Json | null
          output: Json | null
          started_at: string
          status: string
          tokens_used: number | null
          trigger: string
        }
        Insert: {
          agent_id: string
          cost_cents?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json | null
          output?: Json | null
          started_at?: string
          status?: string
          tokens_used?: number | null
          trigger: string
        }
        Update: {
          agent_id?: string
          cost_cents?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          input?: Json | null
          output?: Json | null
          started_at?: string
          status?: string
          tokens_used?: number | null
          trigger?: string
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "agents"
            referencedColumns: ["id"]
          },
        ]
      }
      agents: {
        Row: {
          build_scope: string
          config: Json
          created_at: string
          current_task: string | null
          description: string | null
          id: string
          is_enabled: boolean
          last_result: string | null
          last_run_at: string | null
          name: string
          schedule_cron: string | null
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          build_scope?: string
          config?: Json
          created_at?: string
          current_task?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          last_result?: string | null
          last_run_at?: string | null
          name: string
          schedule_cron?: string | null
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          build_scope?: string
          config?: Json
          created_at?: string
          current_task?: string | null
          description?: string | null
          id?: string
          is_enabled?: boolean
          last_result?: string | null
          last_run_at?: string | null
          name?: string
          schedule_cron?: string | null
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      approvals: {
        Row: {
          action_spec: Json
          build_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          description: string | null
          event_id: string | null
          expires_at: string | null
          id: string
          preview: Json | null
          risk: string
          rule_id: string | null
          status: string
          title: string
        }
        Insert: {
          action_spec: Json
          build_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          description?: string | null
          event_id?: string | null
          expires_at?: string | null
          id?: string
          preview?: Json | null
          risk?: string
          rule_id?: string | null
          status?: string
          title: string
        }
        Update: {
          action_spec?: Json
          build_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          description?: string | null
          event_id?: string | null
          expires_at?: string | null
          id?: string
          preview?: Json | null
          risk?: string
          rule_id?: string | null
          status?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "approvals_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approvals_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      board_filters: {
        Row: {
          config: Json
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          config?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "board_filters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      briefings: {
        Row: {
          body: string
          created_at: string
          generated_for: string
          headline: string
          id: string
          kind: string
          model: string | null
          priorities: Json
          tokens_used: number | null
        }
        Insert: {
          body: string
          created_at?: string
          generated_for?: string
          headline: string
          id?: string
          kind?: string
          model?: string | null
          priorities?: Json
          tokens_used?: number | null
        }
        Update: {
          body?: string
          created_at?: string
          generated_for?: string
          headline?: string
          id?: string
          kind?: string
          model?: string | null
          priorities?: Json
          tokens_used?: number | null
        }
        Relationships: []
      }
      builds: {
        Row: {
          color: string
          created_at: string
          github_path: string | null
          github_repo: string | null
          health_score: number
          id: string
          is_active: boolean
          mrr_target_cents: number
          name: string
          revenue_model: string | null
          slug: string
          sort_order: number
          stage: string
          updated_at: string
        }
        Insert: {
          color?: string
          created_at?: string
          github_path?: string | null
          github_repo?: string | null
          health_score?: number
          id?: string
          is_active?: boolean
          mrr_target_cents?: number
          name: string
          revenue_model?: string | null
          slug: string
          sort_order?: number
          stage?: string
          updated_at?: string
        }
        Update: {
          color?: string
          created_at?: string
          github_path?: string | null
          github_repo?: string | null
          health_score?: number
          id?: string
          is_active?: boolean
          mrr_target_cents?: number
          name?: string
          revenue_model?: string | null
          slug?: string
          sort_order?: number
          stage?: string
          updated_at?: string
        }
        Relationships: []
      }
      connections: {
        Row: {
          config: Json
          created_at: string
          description: string | null
          display_name: string
          id: string
          last_sync_at: string | null
          last_sync_status: string | null
          provider: string
          status: string
          sync_frequency: string | null
          updated_at: string
        }
        Insert: {
          config?: Json
          created_at?: string
          description?: string | null
          display_name: string
          id?: string
          last_sync_at?: string | null
          last_sync_status?: string | null
          provider: string
          status?: string
          sync_frequency?: string | null
          updated_at?: string
        }
        Update: {
          config?: Json
          created_at?: string
          description?: string | null
          display_name?: string
          id?: string
          last_sync_at?: string | null
          last_sync_status?: string | null
          provider?: string
          status?: string
          sync_frequency?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      contributions: {
        Row: {
          amount_cents: number
          build_id: string | null
          contributed_on: string
          created_at: string
          currency: string
          description: string
          id: string
          kind: string
          member_id: string
          notes: string | null
          repaid_on: string | null
          repayable: boolean
          source: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          build_id?: string | null
          contributed_on?: string
          created_at?: string
          currency?: string
          description: string
          id?: string
          kind: string
          member_id: string
          notes?: string | null
          repaid_on?: string | null
          repayable?: boolean
          source?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          build_id?: string | null
          contributed_on?: string
          created_at?: string
          currency?: string
          description?: string
          id?: string
          kind?: string
          member_id?: string
          notes?: string | null
          repaid_on?: string | null
          repayable?: boolean
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contributions_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contributions_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      decisions: {
        Row: {
          build_id: string | null
          context: Json
          created_at: string
          id: string
          kind: string
          outcome: string | null
          outcome_at: string | null
          postmortem: Json | null
          postmortem_at: string | null
          premortem: Json | null
          premortem_at: string | null
          ref_id: string | null
          ref_type: string | null
          title: string
          updated_at: string
        }
        Insert: {
          build_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          kind: string
          outcome?: string | null
          outcome_at?: string | null
          postmortem?: Json | null
          postmortem_at?: string | null
          premortem?: Json | null
          premortem_at?: string | null
          ref_id?: string | null
          ref_type?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          build_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          kind?: string
          outcome?: string | null
          outcome_at?: string | null
          postmortem?: Json | null
          postmortem_at?: string | null
          premortem?: Json | null
          premortem_at?: string | null
          ref_id?: string | null
          ref_type?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "decisions_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      epics: {
        Row: {
          assignee_id: string | null
          build_id: string
          created_at: string
          custom_fields: Json
          description: string | null
          id: string
          initiative_id: string | null
          key: string
          sort_order: number
          status: string
          swimlane: string
          title: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          build_id: string
          created_at?: string
          custom_fields?: Json
          description?: string | null
          id?: string
          initiative_id?: string | null
          key?: string
          sort_order?: number
          status?: string
          swimlane?: string
          title: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          build_id?: string
          created_at?: string
          custom_fields?: Json
          description?: string | null
          id?: string
          initiative_id?: string | null
          key?: string
          sort_order?: number
          status?: string
          swimlane?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "epics_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epics_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "epics_initiative_id_fkey"
            columns: ["initiative_id"]
            isOneToOne: false
            referencedRelation: "initiatives"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          actor: string
          build_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          payload: Json
          processed: boolean
          processed_at: string | null
          type: string
        }
        Insert: {
          actor?: string
          build_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          type: string
        }
        Update: {
          actor?: string
          build_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          payload?: Json
          processed?: boolean
          processed_at?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          ai_categorized: boolean
          amount_cents: number
          build_id: string | null
          category: string
          created_at: string
          currency: string
          description: string | null
          effective_on: string | null
          external_id: string | null
          id: string
          is_recurring: boolean
          notes: string | null
          receipt_path: string | null
          recurrence: string | null
          source: string
          spent_on: string
          tax_deductible: boolean | null
          updated_at: string
          vendor: string
        }
        Insert: {
          ai_categorized?: boolean
          amount_cents: number
          build_id?: string | null
          category: string
          created_at?: string
          currency?: string
          description?: string | null
          effective_on?: string | null
          external_id?: string | null
          id?: string
          is_recurring?: boolean
          notes?: string | null
          receipt_path?: string | null
          recurrence?: string | null
          source?: string
          spent_on?: string
          tax_deductible?: boolean | null
          updated_at?: string
          vendor: string
        }
        Update: {
          ai_categorized?: boolean
          amount_cents?: number
          build_id?: string | null
          category?: string
          created_at?: string
          currency?: string
          description?: string | null
          effective_on?: string | null
          external_id?: string | null
          id?: string
          is_recurring?: boolean
          notes?: string | null
          receipt_path?: string | null
          recurrence?: string | null
          source?: string
          spent_on?: string
          tax_deductible?: boolean | null
          updated_at?: string
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback: {
        Row: {
          build_id: string
          created_at: string
          detail: string | null
          id: string
          kind: string
          linked_ticket_id: string | null
          reporter_ref: string | null
          sentiment: string | null
          severity: string | null
          source: string
          status: string
          summary: string
          updated_at: string
        }
        Insert: {
          build_id: string
          created_at?: string
          detail?: string | null
          id?: string
          kind: string
          linked_ticket_id?: string | null
          reporter_ref?: string | null
          sentiment?: string | null
          severity?: string | null
          source: string
          status?: string
          summary: string
          updated_at?: string
        }
        Update: {
          build_id?: string
          created_at?: string
          detail?: string | null
          id?: string
          kind?: string
          linked_ticket_id?: string | null
          reporter_ref?: string | null
          sentiment?: string | null
          severity?: string | null
          source?: string
          status?: string
          summary?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "feedback_linked_ticket_id_fkey"
            columns: ["linked_ticket_id"]
            isOneToOne: false
            referencedRelation: "tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      github_open_prs: {
        Row: {
          author: string | null
          build_id: string | null
          created_at: string
          draft: boolean
          external_id: string
          id: string
          number: number
          repo: string
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          author?: string | null
          build_id?: string | null
          created_at?: string
          draft?: boolean
          external_id: string
          id?: string
          number: number
          repo: string
          title: string
          updated_at: string
          url?: string | null
        }
        Update: {
          author?: string | null
          build_id?: string | null
          created_at?: string
          draft?: boolean
          external_id?: string
          id?: string
          number?: number
          repo?: string
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "github_open_prs_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      initiatives: {
        Row: {
          build_id: string
          created_at: string
          custom_fields: Json
          description: string | null
          id: string
          key: string
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          build_id: string
          created_at?: string
          custom_fields?: Json
          description?: string | null
          id?: string
          key?: string
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          build_id?: string
          created_at?: string
          custom_fields?: Json
          description?: string | null
          id?: string
          key?: string
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "initiatives_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      learnings: {
        Row: {
          build_id: string | null
          created_at: string
          decision_id: string | null
          id: string
          lesson: string
          source_outcome: string | null
          tags: string[] | null
          weight: number
        }
        Insert: {
          build_id?: string | null
          created_at?: string
          decision_id?: string | null
          id?: string
          lesson: string
          source_outcome?: string | null
          tags?: string[] | null
          weight?: number
        }
        Update: {
          build_id?: string | null
          created_at?: string
          decision_id?: string | null
          id?: string
          lesson?: string
          source_outcome?: string | null
          tags?: string[] | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "learnings_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "learnings_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      member_invites: {
        Row: {
          avatar_color: string | null
          email: string
          full_name: string
          handle: string
          role: string
        }
        Insert: {
          avatar_color?: string | null
          email: string
          full_name: string
          handle: string
          role?: string
        }
        Update: {
          avatar_color?: string | null
          email?: string
          full_name?: string
          handle?: string
          role?: string
        }
        Relationships: []
      }
      members: {
        Row: {
          avatar_color: string | null
          created_at: string
          email: string
          full_name: string
          handle: string
          id: string
          is_active: boolean
          role: string
          updated_at: string
        }
        Insert: {
          avatar_color?: string | null
          created_at?: string
          email: string
          full_name: string
          handle: string
          id: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Update: {
          avatar_color?: string | null
          created_at?: string
          email?: string
          full_name?: string
          handle?: string
          id?: string
          is_active?: boolean
          role?: string
          updated_at?: string
        }
        Relationships: []
      }
      metric_snapshots: {
        Row: {
          build_id: string | null
          captured_on: string
          created_at: string
          id: string
          meta: Json | null
          metric: string
          value_num: number
        }
        Insert: {
          build_id?: string | null
          captured_on?: string
          created_at?: string
          id?: string
          meta?: Json | null
          metric: string
          value_num: number
        }
        Update: {
          build_id?: string | null
          captured_on?: string
          created_at?: string
          id?: string
          meta?: Json | null
          metric?: string
          value_num?: number
        }
        Relationships: [
          {
            foreignKeyName: "metric_snapshots_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          build_id: string | null
          created_at: string
          description: string | null
          done_at: string | null
          id: string
          sort_order: number
          status: string
          target_date: string | null
          title: string
          unlocks: string | null
          updated_at: string
        }
        Insert: {
          build_id?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          id?: string
          sort_order?: number
          status?: string
          target_date?: string | null
          title: string
          unlocks?: string | null
          updated_at?: string
        }
        Update: {
          build_id?: string | null
          created_at?: string
          description?: string | null
          done_at?: string | null
          id?: string
          sort_order?: number
          status?: string
          target_date?: string | null
          title?: string
          unlocks?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestones_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      prospects: {
        Row: {
          booking_clicked: boolean
          build_id: string
          company: string
          contact_email: string | null
          contact_name: string | null
          created_at: string
          employee_count: number | null
          gmail_thread_id: string | null
          id: string
          last_touch_at: string | null
          location: string | null
          next_action: string | null
          next_action_due: string | null
          notes: string | null
          open_count: number
          reply_count: number
          segment: string | null
          signal: string | null
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          booking_clicked?: boolean
          build_id: string
          company: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          employee_count?: number | null
          gmail_thread_id?: string | null
          id?: string
          last_touch_at?: string | null
          location?: string | null
          next_action?: string | null
          next_action_due?: string | null
          notes?: string | null
          open_count?: number
          reply_count?: number
          segment?: string | null
          signal?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Update: {
          booking_clicked?: boolean
          build_id?: string
          company?: string
          contact_email?: string | null
          contact_name?: string | null
          created_at?: string
          employee_count?: number | null
          gmail_thread_id?: string | null
          id?: string
          last_touch_at?: string | null
          location?: string | null
          next_action?: string | null
          next_action_due?: string | null
          notes?: string | null
          open_count?: number
          reply_count?: number
          segment?: string | null
          signal?: string | null
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "prospects_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      repo_activity: {
        Row: {
          author: string | null
          build_id: string
          created_at: string
          external_id: string
          id: string
          kind: string
          occurred_at: string
          ref: string | null
          status: string | null
          title: string
          url: string | null
        }
        Insert: {
          author?: string | null
          build_id: string
          created_at?: string
          external_id: string
          id?: string
          kind: string
          occurred_at?: string
          ref?: string | null
          status?: string | null
          title: string
          url?: string | null
        }
        Update: {
          author?: string | null
          build_id?: string
          created_at?: string
          external_id?: string
          id?: string
          kind?: string
          occurred_at?: string
          ref?: string | null
          status?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "repo_activity_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      revenue_entries: {
        Row: {
          amount_cents: number
          build_id: string
          created_at: string
          currency: string
          customer_ref: string | null
          external_id: string | null
          id: string
          kind: string
          mrr_cents: number
          occurred_on: string
          source: string
          status: string
          updated_at: string
        }
        Insert: {
          amount_cents: number
          build_id: string
          created_at?: string
          currency?: string
          customer_ref?: string | null
          external_id?: string | null
          id?: string
          kind: string
          mrr_cents?: number
          occurred_on?: string
          source: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          build_id?: string
          created_at?: string
          currency?: string
          customer_ref?: string | null
          external_id?: string | null
          id?: string
          kind?: string
          mrr_cents?: number
          occurred_on?: string
          source?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "revenue_entries_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
      rules: {
        Row: {
          actions: Json
          build_scope: string
          conditions: Json
          config: Json
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          name: string
          priority: number
          requires_approval: boolean
          trigger_event: string
          updated_at: string
        }
        Insert: {
          actions?: Json
          build_scope?: string
          conditions?: Json
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          name: string
          priority?: number
          requires_approval?: boolean
          trigger_event: string
          updated_at?: string
        }
        Update: {
          actions?: Json
          build_scope?: string
          conditions?: Json
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_enabled?: boolean
          name?: string
          priority?: number
          requires_approval?: boolean
          trigger_event?: string
          updated_at?: string
        }
        Relationships: []
      }
      tickets: {
        Row: {
          assignee_id: string | null
          blocks_milestone_id: string | null
          build_id: string
          closed_at: string | null
          created_at: string
          custom_fields: Json
          description: string | null
          epic_id: string | null
          estimate_minutes: number | null
          external_id: string | null
          external_url: string | null
          id: string
          is_blocker: boolean
          key: string
          labels: string[] | null
          points: number | null
          priority: string
          pullable: boolean
          ref: string | null
          source: string
          stage: string
          stage_changed_at: string
          sub_status: string | null
          swimlane: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          assignee_id?: string | null
          blocks_milestone_id?: string | null
          build_id: string
          closed_at?: string | null
          created_at?: string
          custom_fields?: Json
          description?: string | null
          epic_id?: string | null
          estimate_minutes?: number | null
          external_id?: string | null
          external_url?: string | null
          id?: string
          is_blocker?: boolean
          key?: string
          labels?: string[] | null
          points?: number | null
          priority?: string
          pullable?: boolean
          ref?: string | null
          source?: string
          stage?: string
          stage_changed_at?: string
          sub_status?: string | null
          swimlane?: string
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          assignee_id?: string | null
          blocks_milestone_id?: string | null
          build_id?: string
          closed_at?: string | null
          created_at?: string
          custom_fields?: Json
          description?: string | null
          epic_id?: string | null
          estimate_minutes?: number | null
          external_id?: string | null
          external_url?: string | null
          id?: string
          is_blocker?: boolean
          key?: string
          labels?: string[] | null
          points?: number | null
          priority?: string
          pullable?: boolean
          ref?: string | null
          source?: string
          stage?: string
          stage_changed_at?: string
          sub_status?: string | null
          swimlane?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tickets_assignee_id_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tickets_epic_id_fkey"
            columns: ["epic_id"]
            isOneToOne: false
            referencedRelation: "epics"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_templates: {
        Row: {
          build_id: string | null
          created_at: string
          fields: Json
          id: string
          item_type: string
          updated_at: string
        }
        Insert: {
          build_id?: string | null
          created_at?: string
          fields?: Json
          id?: string
          item_type: string
          updated_at?: string
        }
        Update: {
          build_id?: string | null
          created_at?: string
          fields?: Json
          id?: string
          item_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_templates_build_id_fkey"
            columns: ["build_id"]
            isOneToOne: false
            referencedRelation: "builds"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      advance_ticket: {
        Args: { p_ticket_id: string; p_to_stage: string }
        Returns: {
          assignee_id: string | null
          blocks_milestone_id: string | null
          build_id: string
          closed_at: string | null
          created_at: string
          custom_fields: Json
          description: string | null
          epic_id: string | null
          estimate_minutes: number | null
          external_id: string | null
          external_url: string | null
          id: string
          is_blocker: boolean
          key: string
          labels: string[] | null
          points: number | null
          priority: string
          pullable: boolean
          ref: string | null
          source: string
          stage: string
          stage_changed_at: string
          sub_status: string | null
          swimlane: string
          title: string
          type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "tickets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      decide_approval: {
        Args: { p_approval_id: string; p_decision: string }
        Returns: {
          action_spec: Json
          build_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          description: string | null
          event_id: string | null
          expires_at: string | null
          id: string
          preview: Json | null
          risk: string
          rule_id: string | null
          status: string
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "approvals"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      delete_connection_secret: {
        Args: { p_key_name: string; p_provider: string }
        Returns: undefined
      }
      is_founder: { Args: never; Returns: boolean }
      is_member: { Args: never; Returns: boolean }
      log_login: { Args: never; Returns: undefined }
      read_secret: { Args: { p_name: string }; Returns: string }
      request_agent_run: {
        Args: { p_input?: Json; p_slug: string }
        Returns: undefined
      }
      set_connection: {
        Args: { p_provider: string; p_status: string; p_sync_frequency: string }
        Returns: {
          config: Json
          created_at: string
          description: string | null
          display_name: string
          id: string
          last_sync_at: string | null
          last_sync_status: string | null
          provider: string
          status: string
          sync_frequency: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "connections"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      set_connection_secret: {
        Args: { p_key_name: string; p_provider: string; p_value: string }
        Returns: undefined
      }
      set_rule_enabled: {
        Args: { p_enabled: boolean; p_id: string }
        Returns: {
          actions: Json
          build_scope: string
          conditions: Json
          config: Json
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          name: string
          priority: number
          requires_approval: boolean
          trigger_event: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_rule: {
        Args: {
          p_actions: Json
          p_auto_approve_medium: boolean
          p_build_scope: string
          p_conditions: Json
          p_description: string
          p_id: string
          p_is_enabled: boolean
          p_name: string
          p_priority: number
          p_requires_approval: boolean
          p_trigger_event: string
        }
        Returns: {
          actions: Json
          build_scope: string
          conditions: Json
          config: Json
          created_at: string
          description: string | null
          id: string
          is_enabled: boolean
          name: string
          priority: number
          requires_approval: boolean
          trigger_event: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "rules"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      write_secret: {
        Args: { p_key_name: string; p_provider: string; p_value: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
