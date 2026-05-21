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
      alerts: {
        Row: {
          created_at: string
          id: string
          message: string
          metadata: Json
          resolved_at: string | null
          severity: string
          type: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          resolved_at?: string | null
          severity?: string
          type: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          resolved_at?: string | null
          severity?: string
          type?: string
        }
        Relationships: []
      }
      campaign_events: {
        Row: {
          campaign_id: string
          channel_id: string | null
          contact_id: string | null
          created_at: string
          error: string | null
          event_type: Database["public"]["Enums"]["campaign_event_type"]
          id: string
          metadata: Json
          recipient_id: string | null
        }
        Insert: {
          campaign_id: string
          channel_id?: string | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          event_type: Database["public"]["Enums"]["campaign_event_type"]
          id?: string
          metadata?: Json
          recipient_id?: string | null
        }
        Update: {
          campaign_id?: string
          channel_id?: string | null
          contact_id?: string | null
          created_at?: string
          error?: string | null
          event_type?: Database["public"]["Enums"]["campaign_event_type"]
          id?: string
          metadata?: Json
          recipient_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_events_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_events_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "campaign_recipients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_recipients: {
        Row: {
          campaign_id: string
          channel_id: string | null
          contact_id: string
          created_at: string
          error: string | null
          id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["recipient_status"]
        }
        Insert: {
          campaign_id: string
          channel_id?: string | null
          contact_id: string
          created_at?: string
          error?: string | null
          id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Update: {
          campaign_id?: string
          channel_id?: string | null
          contact_id?: string
          created_at?: string
          error?: string | null
          id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["recipient_status"]
        }
        Relationships: [
          {
            foreignKeyName: "campaign_recipients_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_recipients_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_send_settings: {
        Row: {
          allowed_end_time: string
          allowed_start_time: string
          allowed_weekdays: number[]
          auto_pause_on_all_channels_down: boolean
          auto_pause_outside_hours: boolean
          batch_mode: boolean
          batch_pause_seconds: number | null
          campaign_id: string
          channel_priority: string[]
          created_at: string
          delay_seconds: number
          max_per_day_per_channel: number
          max_per_hour: number
          max_per_minute: number
          random_delay_max: number | null
          random_delay_min: number | null
          rotation_cursor: number
          rotation_mode: Database["public"]["Enums"]["rotation_mode"]
          selected_channel_ids: string[]
          timezone: string
          updated_at: string
        }
        Insert: {
          allowed_end_time?: string
          allowed_start_time?: string
          allowed_weekdays?: number[]
          auto_pause_on_all_channels_down?: boolean
          auto_pause_outside_hours?: boolean
          batch_mode?: boolean
          batch_pause_seconds?: number | null
          campaign_id: string
          channel_priority?: string[]
          created_at?: string
          delay_seconds?: number
          max_per_day_per_channel?: number
          max_per_hour?: number
          max_per_minute?: number
          random_delay_max?: number | null
          random_delay_min?: number | null
          rotation_cursor?: number
          rotation_mode?: Database["public"]["Enums"]["rotation_mode"]
          selected_channel_ids?: string[]
          timezone?: string
          updated_at?: string
        }
        Update: {
          allowed_end_time?: string
          allowed_start_time?: string
          allowed_weekdays?: number[]
          auto_pause_on_all_channels_down?: boolean
          auto_pause_outside_hours?: boolean
          batch_mode?: boolean
          batch_pause_seconds?: number | null
          campaign_id?: string
          channel_priority?: string[]
          created_at?: string
          delay_seconds?: number
          max_per_day_per_channel?: number
          max_per_hour?: number
          max_per_minute?: number
          random_delay_max?: number | null
          random_delay_min?: number | null
          rotation_cursor?: number
          rotation_mode?: Database["public"]["Enums"]["rotation_mode"]
          selected_channel_ids?: string[]
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_send_settings_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: true
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          audience_filter: Json
          channel_ids: string[]
          channel_strategy: Database["public"]["Enums"]["channel_strategy"]
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          media_filename: string | null
          media_mime: string | null
          media_type: string | null
          media_url: string | null
          message_template: string
          name: string
          rate_per_min: number
          scheduled_at: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          total_recipients: number
          updated_at: string
          variables: Json
        }
        Insert: {
          audience_filter?: Json
          channel_ids?: string[]
          channel_strategy?: Database["public"]["Enums"]["channel_strategy"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_type?: string | null
          media_url?: string | null
          message_template: string
          name: string
          rate_per_min?: number
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          total_recipients?: number
          updated_at?: string
          variables?: Json
        }
        Update: {
          audience_filter?: Json
          channel_ids?: string[]
          channel_strategy?: Database["public"]["Enums"]["channel_strategy"]
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_type?: string | null
          media_url?: string | null
          message_template?: string
          name?: string
          rate_per_min?: number
          scheduled_at?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          total_recipients?: number
          updated_at?: string
          variables?: Json
        }
        Relationships: []
      }
      channel_api_keys: {
        Row: {
          channel_id: string
          created_at: string
          created_by: string | null
          hint: string
          id: string
          key_encrypted: string
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          status: Database["public"]["Enums"]["channel_key_status"]
          version: number
        }
        Insert: {
          channel_id: string
          created_at?: string
          created_by?: string | null
          hint: string
          id?: string
          key_encrypted: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          status?: Database["public"]["Enums"]["channel_key_status"]
          version: number
        }
        Update: {
          channel_id?: string
          created_at?: string
          created_by?: string | null
          hint?: string
          id?: string
          key_encrypted?: string
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          status?: Database["public"]["Enums"]["channel_key_status"]
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "channel_api_keys_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          business_hours: Json
          created_at: string
          created_by: string | null
          daily_limit: number
          id: string
          label: string
          last_error: string | null
          phone_e164: string
          sent_today: number
          sent_today_date: string
          status: Database["public"]["Enums"]["channel_status"]
          updated_at: string
          zion_api_key: string
          zion_api_key_encrypted: string | null
          zion_api_key_hint: string | null
        }
        Insert: {
          business_hours?: Json
          created_at?: string
          created_by?: string | null
          daily_limit?: number
          id?: string
          label: string
          last_error?: string | null
          phone_e164: string
          sent_today?: number
          sent_today_date?: string
          status?: Database["public"]["Enums"]["channel_status"]
          updated_at?: string
          zion_api_key: string
          zion_api_key_encrypted?: string | null
          zion_api_key_hint?: string | null
        }
        Update: {
          business_hours?: Json
          created_at?: string
          created_by?: string | null
          daily_limit?: number
          id?: string
          label?: string
          last_error?: string | null
          phone_e164?: string
          sent_today?: number
          sent_today_date?: string
          status?: Database["public"]["Enums"]["channel_status"]
          updated_at?: string
          zion_api_key?: string
          zion_api_key_encrypted?: string | null
          zion_api_key_hint?: string | null
        }
        Relationships: []
      }
      contact_imports: {
        Row: {
          created_at: string
          created_by: string | null
          errors: Json | null
          failed: number
          file_name: string
          id: string
          success: number
          total: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          errors?: Json | null
          failed?: number
          file_name: string
          id?: string
          success?: number
          total?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          errors?: Json | null
          failed?: number
          file_name?: string
          id?: string
          success?: number
          total?: number
        }
        Relationships: []
      }
      contact_list_items: {
        Row: {
          contact_id: string
          created_at: string
          id: string
          list_id: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          id?: string
          list_id: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          id?: string
          list_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_list_items_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_list_items_list_id_fkey"
            columns: ["list_id"]
            isOneToOne: false
            referencedRelation: "contact_lists"
            referencedColumns: ["id"]
          },
        ]
      }
      contact_lists: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      contacts: {
        Row: {
          consent: boolean
          consent_at: string | null
          created_at: string
          created_by: string | null
          custom_fields: Json
          id: string
          name: string
          opt_out_at: string | null
          phone_e164: string
          source: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          consent?: boolean
          consent_at?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          id?: string
          name: string
          opt_out_at?: string | null
          phone_e164: string
          source?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          consent?: boolean
          consent_at?: string | null
          created_at?: string
          created_by?: string | null
          custom_fields?: Json
          id?: string
          name?: string
          opt_out_at?: string | null
          phone_e164?: string
          source?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          assigned_to: string | null
          channel_id: string | null
          contact_id: string
          created_at: string
          id: string
          last_message_at: string
          status: Database["public"]["Enums"]["conversation_status"]
          tags: string[]
          unread_count: number
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          channel_id?: string | null
          contact_id: string
          created_at?: string
          id?: string
          last_message_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          tags?: string[]
          unread_count?: number
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          channel_id?: string | null
          contact_id?: string
          created_at?: string
          id?: string
          last_message_at?: string
          status?: Database["public"]["Enums"]["conversation_status"]
          tags?: string[]
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      message_queue: {
        Row: {
          attachments: Json
          attempts: number
          campaign_recipient_id: string | null
          channel_id: string
          contact_id: string
          created_at: string
          id: string
          last_error: string | null
          processed_at: string | null
          rendered_text: string
          scheduled_for: string
          status: Database["public"]["Enums"]["queue_status"]
        }
        Insert: {
          attachments?: Json
          attempts?: number
          campaign_recipient_id?: string | null
          channel_id: string
          contact_id: string
          created_at?: string
          id?: string
          last_error?: string | null
          processed_at?: string | null
          rendered_text: string
          scheduled_for?: string
          status?: Database["public"]["Enums"]["queue_status"]
        }
        Update: {
          attachments?: Json
          attempts?: number
          campaign_recipient_id?: string | null
          channel_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_error?: string | null
          processed_at?: string | null
          rendered_text?: string
          scheduled_for?: string
          status?: Database["public"]["Enums"]["queue_status"]
        }
        Relationships: [
          {
            foreignKeyName: "message_queue_campaign_recipient_id_fkey"
            columns: ["campaign_recipient_id"]
            isOneToOne: false
            referencedRelation: "campaign_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_queue_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "message_queue_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          attachments: Json
          body: string | null
          campaign_id: string | null
          conversation_id: string
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["message_direction"]
          external_id: string | null
          id: string
          internal_note: boolean
          sent_via_channel_id: string | null
        }
        Insert: {
          attachments?: Json
          body?: string | null
          campaign_id?: string | null
          conversation_id: string
          created_at?: string
          created_by?: string | null
          direction: Database["public"]["Enums"]["message_direction"]
          external_id?: string | null
          id?: string
          internal_note?: boolean
          sent_via_channel_id?: string | null
        }
        Update: {
          attachments?: Json
          body?: string | null
          campaign_id?: string | null
          conversation_id?: string
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["message_direction"]
          external_id?: string | null
          id?: string
          internal_note?: boolean
          sent_via_channel_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sent_via_channel_id_fkey"
            columns: ["sent_via_channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      opt_out_keywords: {
        Row: {
          created_at: string
          id: string
          keyword: string
        }
        Insert: {
          created_at?: string
          id?: string
          keyword: string
        }
        Update: {
          created_at?: string
          id?: string
          keyword?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      quick_replies: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          title: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          title: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          title?: string
        }
        Relationships: []
      }
      send_logs: {
        Row: {
          campaign_id: string | null
          channel_id: string | null
          contact_id: string | null
          created_at: string
          http_status: number | null
          id: string
          response_text: string | null
        }
        Insert: {
          campaign_id?: string | null
          channel_id?: string | null
          contact_id?: string | null
          created_at?: string
          http_status?: number | null
          id?: string
          response_text?: string | null
        }
        Update: {
          campaign_id?: string | null
          channel_id?: string | null
          contact_id?: string | null
          created_at?: string
          http_status?: number | null
          id?: string
          response_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "send_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "send_logs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "send_logs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_user_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_channel_api_key: {
        Args: { p_channel_id: string; p_secret: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      revoke_channel_api_key: {
        Args: { p_key_id: string; p_reason?: string; p_user: string }
        Returns: undefined
      }
      rotate_channel_api_key: {
        Args: {
          p_channel_id: string
          p_plain_key: string
          p_secret: string
          p_user: string
        }
        Returns: string
      }
      set_channel_api_key: {
        Args: { p_channel_id: string; p_plain_key: string; p_secret: string }
        Returns: undefined
      }
      unaccent_safe: { Args: { txt: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "gestor" | "atendente"
      campaign_event_type:
        | "queued"
        | "sent"
        | "delivered"
        | "failed"
        | "opted_out"
      campaign_status: "draft" | "scheduled" | "running" | "paused" | "done"
      channel_key_status: "active" | "superseded" | "revoked"
      channel_status: "connected" | "disconnected" | "error" | "paused"
      channel_strategy: "round_robin" | "specific"
      conversation_status:
        | "novo"
        | "em_atendimento"
        | "aguardando_cliente"
        | "resolvido"
      message_direction: "in" | "out"
      queue_status: "pending" | "processing" | "sent" | "failed"
      recipient_status: "queued" | "sent" | "delivered" | "failed" | "opted_out"
      rotation_mode: "round_robin" | "least_used" | "manual_priority"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
      app_role: ["admin", "gestor", "atendente"],
      campaign_event_type: [
        "queued",
        "sent",
        "delivered",
        "failed",
        "opted_out",
      ],
      campaign_status: ["draft", "scheduled", "running", "paused", "done"],
      channel_key_status: ["active", "superseded", "revoked"],
      channel_status: ["connected", "disconnected", "error", "paused"],
      channel_strategy: ["round_robin", "specific"],
      conversation_status: [
        "novo",
        "em_atendimento",
        "aguardando_cliente",
        "resolvido",
      ],
      message_direction: ["in", "out"],
      queue_status: ["pending", "processing", "sent", "failed"],
      recipient_status: ["queued", "sent", "delivered", "failed", "opted_out"],
      rotation_mode: ["round_robin", "least_used", "manual_priority"],
    },
  },
} as const
