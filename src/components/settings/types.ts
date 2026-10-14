export interface PinCode {
  id: string;
  user_id: string;
  pin: string;
  email: string;
  shortcut_code: string;
}

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: string;
  department: string;
  status: string;
  vk_link: string | null;
  vk_id: string | null;
}
