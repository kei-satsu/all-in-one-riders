import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useThemeStyles } from '../lib/theme-provider';

export default function LoginScreen() {
  const styles = useThemeStyles(baseStyles);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      setErrorMessage('Email နှင့် Password ဖြည့်သွင်းပေးပါ။');
      return;
    }

    if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) {
      setErrorMessage('Supabase configuration မရှိပါ။ Admin ကိုဆက်သွယ်ပါ။');
      return;
    }

    setErrorMessage('');
    setLoading(true);

    try {
      const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (authError) {
        setErrorMessage(
          authError.message.toLowerCase() === 'invalid login credentials'
            ? 'Email သို့မဟုတ် password မှားနေပါသည်။ Rider အကောင့်အချက်အလက်ကို ပြန်စစ်ပါ။'
            : authError.message,
        );
        return;
      }

      const userEmail = authData.user?.email;

      if (!userEmail) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.error('Could not clear a session without a user email.', signOutError);
        }
        setErrorMessage('User Email ရှာမတွေ့ပါ။');
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('rider_id')
        .eq('email', userEmail)
        .maybeSingle();
      if (profileError) throw profileError;

      if (!profileData?.rider_id) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.error('Could not clear a session without a rider profile.', signOutError);
        }
        setErrorMessage('ဝင်ခွင့်မရှိပါ။ Rider account နဲ့ ဝင်ပါ။');
        return;
      }

      const { data: riderData, error: riderError } = await supabase
        .from('riders')
        .select('id')
        .eq('id', profileData.rider_id)
        .maybeSingle();
      if (riderError) throw riderError;

      if (!riderData) {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.error('Could not clear a session without a rider record.', signOutError);
        }
        setErrorMessage('ဝင်ခွင့်မရှိပါ။ Rider account နဲ့ ဝင်ပါ။');
        return;
      }

      router.replace('/(tabs)');
    } catch (error: unknown) {
      console.error('Rider login failed.', error);
      setErrorMessage(error instanceof Error ? error.message : 'တစ်စုံတစ်ခု မှားယွင်းနေပါသည်။');
      try {
        const { error: signOutError } = await supabase.auth.signOut();
        if (signOutError) {
          console.error('Could not clear the session after a login error.', signOutError);
        }
      } catch (signOutError) {
        console.error('Could not clear the session after a login error.', signOutError);
      }
    } finally {
      setLoading(false);
    }
  };

  return React.createElement(
    KeyboardAvoidingView,
    {
      behavior: Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined,
      style: styles.container,
    },
    React.createElement(
      View,
      { style: styles.formContainer },
      React.createElement(Image, {
    source: require('../assets/images/logo.png'), // မိမိ ပုံလမ်းကြောင်း (သို့) { uri: 'https://...' }
    style: styles.logo,
    resizeMode: 'contain',
  }),
      React.createElement(Text, { style: styles.title }, 'All In One Riders Login'),
  errorMessage
    ? React.createElement(
        Text,
        { style: styles.errorMessage, accessibilityRole: 'alert' },
        errorMessage,
      )
    : null,
  React.createElement(Text, { style: styles.label }, 'Email'),
      React.createElement(TextInput, {
        style: styles.input,
        placeholder: 'example@gmail.com',
        value: email,
        onChangeText: setEmail,
        autoCapitalize: 'none',
        keyboardType: 'email-address',
      }),
      React.createElement(Text, { style: styles.label }, 'Password'),
      React.createElement(TextInput, {
        style: styles.input,
        placeholder: '••••••••',
        value: password,
        onChangeText: setPassword,
        secureTextEntry: true,
      }),
      React.createElement(
        TouchableOpacity,
        {
          style: [styles.button, loading && styles.buttonDisabled],
          onPress: handleLogin,
          disabled: loading,
        },
        loading
          ? React.createElement(ActivityIndicator, { color: '#ffffff' })
          : React.createElement(Text, { style: styles.buttonText }, 'Login ဝင်မည်')
      )
    )
  );
}

const baseStyles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    minHeight: '100%',
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  formContainer: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    backgroundColor: '#ffffff',
    padding: 24,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 24,
    textAlign: 'center',
    color: '#333333',
  },
  label: {
    fontSize: 14,
    color: '#666666',
    marginBottom: 6,
  },
  input: {
    height: 48,
    borderColor: '#dddddd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 16,
    fontSize: 16,
    color: '#333333',
    backgroundColor: '#fafafa',
  },
  button: {
    height: 48,
    backgroundColor: '#f97316',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    backgroundColor: '#fdba74',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorMessage: {
    marginBottom: 18,
    padding: 12,
    borderRadius: 8,
    backgroundColor: '#fef2f2',
    color: '#b91c1c',
    fontSize: 14,
  },
  logo: {
    width: 120,
    height: 120,
    alignSelf: 'center',
    marginBottom: 15,
  },
});