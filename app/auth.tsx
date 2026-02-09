// app/auth.tsx
import { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSignIn, useSignUp, useOAuth, useAuth } from '@clerk/clerk-expo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MaterialIcons, MaterialCommunityIcons, Feather } from '@expo/vector-icons';
import { getClerkJWT } from '@/services/jwt';

type AuthMode = 'signin' | 'signup' | 'verify-email' | 'forgot-password' | 'forgot-password-code';

const AuthPage = () => {
  const router = useRouter();
  const [mode, setMode] = useState<AuthMode>('signin');
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [spinnerRotation, setSpinnerRotation] = useState(0);
  const [error, setError] = useState<string>('');
  const [pendingEmail, setPendingEmail] = useState<string>('');
  const intervalId = useRef<ReturnType<typeof setInterval> | null>(null);

  const { signIn, setActive } = useSignIn();
  const { signUp, setActive: setActiveSignUp } = useSignUp();
  const { startOAuthFlow } = useOAuth({ strategy: 'oauth_google' });
  const { getToken } = useAuth();

  // Simple spinner animation
  useEffect(() => {
    if (isLoading) {
      intervalId.current = setInterval(() => {
        setSpinnerRotation(prev => (prev + 30) % 360);
      }, 50);
    } else {
      if (intervalId.current) {
        clearInterval(intervalId.current);
        intervalId.current = null;
      }
      setSpinnerRotation(0);
    }
    
    return () => {
      if (intervalId.current) {
        clearInterval(intervalId.current);
      }
    };
  }, [isLoading]);

  // Add CAPTCHA element for web (Clerk bot protection)
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      // Check if CAPTCHA element already exists
      if (!document.getElementById('clerk-captcha')) {
        const captchaElement = document.createElement('div');
        captchaElement.id = 'clerk-captcha';
        captchaElement.style.display = 'none';
        captchaElement.style.position = 'absolute';
        captchaElement.style.visibility = 'hidden';
        captchaElement.style.width = '0';
        captchaElement.style.height = '0';
        document.body.appendChild(captchaElement);
      }
    }
    
    // Cleanup on unmount
    return () => {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const captchaElement = document.getElementById('clerk-captcha');
        if (captchaElement && captchaElement.parentNode) {
          captchaElement.remove();
        }
      }
    };
  }, []);

  // Handle Google OAuth
  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      const { createdSessionId, setActive } = await startOAuthFlow();
      
      if (createdSessionId && setActive) {
        try {
          await setActive({ session: createdSessionId });
        } catch (sessionError: any) {
          // Handle "session already exists" error gracefully
          if (sessionError?.errors?.[0]?.code === 'session_exists' || 
              sessionError?.message?.includes('session') ||
              sessionError?.message?.includes('already')) {
            console.log('Session already active, continuing...');
          } else {
            throw sessionError;
          }
        }
        
        // Generate and store JWT token after successful authentication
        if (getToken) {
          try {
            await getClerkJWT(getToken);
            console.log('JWT token generated and stored after Google sign-in');
          } catch (jwtError) {
            console.error('Error generating JWT after Google sign-in:', jwtError);
            // Don't block navigation if JWT generation fails
          }
        }
        
        router.replace('/(tabs)/chat');
      } else {
        setError('Google sign-in failed. Please try again.');
      }
    } catch (err: any) {
      console.error('Google OAuth error:', err);
      setError(err.message || 'Google sign-in failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle Email/Password Authentication
  const handleEmailAuth = async () => {
    setIsLoading(true);
    setError('');
    
    try {
      if (mode === 'signin') {
        // Sign In
        if (!signIn) {
          setError('Sign in service not available');
          return;
        }

        const signInAttempt = await signIn.create({
          identifier: email,
          password,
        });

        if (signInAttempt.status === 'complete') {
          if (setActive) {
            try {
              await setActive({ session: signInAttempt.createdSessionId });
            } catch (sessionError: any) {
              // Handle "session already exists" error gracefully
              if (sessionError?.errors?.[0]?.code === 'session_exists' || 
                  sessionError?.message?.includes('session') ||
                  sessionError?.message?.includes('already')) {
                console.log('Session already active, continuing...');
              } else {
                throw sessionError;
              }
            }
            
            // Generate and store JWT token after successful authentication
            if (getToken) {
              try {
                await getClerkJWT(getToken);
                console.log('JWT token generated and stored after email sign-in');
              } catch (jwtError) {
                console.error('Error generating JWT after email sign-in:', jwtError);
                // Don't block navigation if JWT generation fails
              }
            }
            
            router.replace('/(tabs)/chat');
          } else {
            setError('Unable to set active session');
          }
        } else {
          setError('Sign in failed. Please check your credentials.');
        }
      } else {
        // Sign Up
        if (!signUp) {
          setError('Sign up service not available');
          return;
        }

        const signUpAttempt = await signUp.create({
          emailAddress: email,
          password,
        });

        if (signUpAttempt.status === 'complete') {
          if (setActiveSignUp) {
            try {
              await setActiveSignUp({ session: signUpAttempt.createdSessionId });
            } catch (sessionError: any) {
              // Handle "session already exists" error gracefully
              if (sessionError?.errors?.[0]?.code === 'session_exists' || 
                  sessionError?.message?.includes('session') ||
                  sessionError?.message?.includes('already')) {
                console.log('Session already active, continuing...');
              } else {
                throw sessionError;
              }
            }
            
            // Generate and store JWT token after successful authentication
            if (getToken) {
              try {
                await getClerkJWT(getToken);
                console.log('JWT token generated and stored after email sign-up');
              } catch (jwtError) {
                console.error('Error generating JWT after email sign-up:', jwtError);
                // Don't block navigation if JWT generation fails
              }
            }
            
            router.replace('/(tabs)/chat');
          } else {
            setError('Unable to set active session');
          }
        } else if (signUpAttempt.status === 'missing_requirements') {
          // Email verification required - prepare verification
          try {
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
            setPendingEmail(email);
            setMode('verify-email');
            setError('');
            console.log('Verification email sent. Please check your inbox.');
          } catch (verifyError: any) {
            console.error('Error preparing email verification:', verifyError);
            setError(verifyError.errors?.[0]?.message || 'Failed to send verification email. Please try again.');
          }
        } else {
          // Other status - show error
          setError('Please check your email for verification.');
        }
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err.errors?.[0]?.message || 'Authentication failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle email verification
  const handleEmailVerification = async () => {
    if (!signUp || !verificationCode.trim()) {
      setError('Please enter the verification code');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const verificationAttempt = await signUp.attemptEmailAddressVerification({
        code: verificationCode,
      });

      if (verificationAttempt.status === 'complete') {
        if (setActiveSignUp) {
          try {
            await setActiveSignUp({ session: verificationAttempt.createdSessionId });
          } catch (sessionError: any) {
            // Handle "session already exists" error gracefully
            if (sessionError?.errors?.[0]?.code === 'session_exists' || 
                sessionError?.message?.includes('session') ||
                sessionError?.message?.includes('already')) {
              console.log('Session already active, continuing...');
            } else {
              throw sessionError;
            }
          }
          
          // Generate and store JWT token after successful verification
          if (getToken) {
            try {
              await getClerkJWT(getToken);
              console.log('JWT token generated and stored after email verification');
            } catch (jwtError) {
              console.error('Error generating JWT after email verification:', jwtError);
              // Don't block navigation if JWT generation fails
            }
          }
          
          router.replace('/(tabs)/chat');
        } else {
          setError('Unable to set active session');
        }
      } else {
        setError('Invalid verification code. Please try again.');
      }
    } catch (err: any) {
      console.error('Verification error:', err);
      setError(err.errors?.[0]?.message || 'Verification failed. Please check your code and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  // Forgot password: send reset code to email
  const handleForgotPasswordSend = async () => {
    if (!email.trim()) {
      setError('Enter your email address');
      return;
    }
    if (!signIn) {
      setError('Sign in service not available');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      await signIn.create({
        strategy: 'reset_password_email_code',
        identifier: email.trim(),
      });
      setMode('forgot-password-code');
      setError('');
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? err?.message ?? 'Failed to send reset code';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Forgot password: submit code + new password
  const handleForgotPasswordReset = async () => {
    if (!resetCode.trim() || !newPassword.trim()) {
      setError('Enter the code from your email and a new password');
      return;
    }
    if (!signIn || !setActive) {
      setError('Sign in service not available');
      return;
    }
    setIsLoading(true);
    setError('');
    try {
      const result = await signIn.attemptFirstFactor({
        strategy: 'reset_password_email_code',
        code: resetCode.trim(),
        password: newPassword.trim(),
      });
      if (result.status === 'complete' && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        if (getToken) {
          try {
            await getClerkJWT(getToken);
          } catch (e) {
            console.warn('JWT after reset:', e);
          }
        }
        router.replace('/(tabs)/chat');
      } else if (result.status === 'needs_second_factor') {
        setError('Two-factor authentication is required. Please sign in with 2FA.');
      } else {
        setError('Password reset did not complete. Please try again.');
      }
    } catch (err: any) {
      const msg = err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? err?.message ?? 'Failed to reset password';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  };

  // Resend verification email
  const handleResendVerification = async () => {
    if (!signUp || !pendingEmail) {
      setError('Unable to resend verification email');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' });
      setError('');
      console.log('Verification email resent. Please check your inbox.');
      // Show success message briefly
      setTimeout(() => {
        setError('');
      }, 3000);
    } catch (err: any) {
      console.error('Resend verification error:', err);
      setError(err.errors?.[0]?.message || 'Failed to resend verification email');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0B1220' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Ambient background effects */}
          <View style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
            <View style={{
              position: 'absolute',
              top: '25%',
              left: '25%',
              width: 384,
              height: 384,
              borderRadius: 192,
              backgroundColor: 'rgba(0, 229, 255, 0.1)',
              transform: [{ translateX: -192 }, { translateY: -192 }],
              opacity: 0.5,
            }} />
            <View style={{
              position: 'absolute',
              bottom: '25%',
              right: '25%',
              width: 384,
              height: 384,
              borderRadius: 192,
              backgroundColor: 'rgba(120, 119, 198, 0.1)',
              transform: [{ translateX: 192 }, { translateY: 192 }],
              opacity: 0.5,
            }} />
          </View>

          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
            {/* Logo & Branding */}
            <View style={{ alignItems: 'center', marginBottom: 32 }}>
              <View style={{
                width: 80,
                height: 80,
                borderRadius: 24,
                backgroundColor: '#00E5FF',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 16,
                shadowColor: '#00E5FF',
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.25,
                shadowRadius: 20,
                elevation: 10,
              }}>
                <MaterialCommunityIcons name="brain" size={40} color="white" />
              </View>
              <Text style={{ fontSize: 24, fontWeight: 'bold', color: 'white', marginBottom: 4 }}>
                Welcome to Second Brain
              </Text>
              <Text style={{ fontSize: 14, color: '#9CA3AF' }}>
                Your AI-powered personal assistant
              </Text>
            </View>

            {/* Error Message */}
            {error ? (
              <View style={{
                width: '100%',
                maxWidth: 400,
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderWidth: 1,
                borderColor: '#EF4444',
                borderRadius: 12,
                padding: 12,
                marginBottom: 16,
              }}>
                <Text style={{ color: '#EF4444', fontSize: 12, textAlign: 'center' }}>
                  {error}
                </Text>
              </View>
            ) : null}

            {/* Auth Card */}
            <View style={{
              width: '100%',
              maxWidth: 400,
              backgroundColor: 'rgba(30, 41, 59, 0.8)',
              borderRadius: 24,
              padding: 24,
              borderWidth: 1,
              borderColor: '#374151',
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.5,
              shadowRadius: 40,
              elevation: 25,
            }}>
              {/* Forgot Password: enter email */}
              {mode === 'forgot-password' ? (
                <View style={{ gap: 16 }}>
                  <View style={{ alignItems: 'center', marginBottom: 8 }}>
                    <Feather name="key" size={48} color="#00E5FF" style={{ marginBottom: 12 }} />
                    <Text style={{ fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 8, textAlign: 'center' }}>
                      Reset password
                    </Text>
                    <Text style={{ fontSize: 14, color: '#9CA3AF', textAlign: 'center' }}>
                      Enter your email and we'll send you a code
                    </Text>
                  </View>
                  <View style={{ gap: 8 }}>
                    <Label>Email</Label>
                    <Input
                      placeholder="you@example.com"
                      value={email}
                      onChangeText={(text) => { setEmail(text); setError(''); }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      editable={!isLoading}
                    />
                  </View>
                  <Button
                    onPress={handleForgotPasswordSend}
                    disabled={isLoading || !email.trim()}
                    style={{ width: '100%', height: 48, borderRadius: 24, backgroundColor: '#00E5FF', opacity: (!email.trim() || isLoading) ? 0.7 : 1 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      {isLoading ? (
                        <View style={{ transform: [{ rotate: `${spinnerRotation}deg` }] }}>
                          <Feather name="loader" size={20} color="white" />
                        </View>
                      ) : (
                        <>
                          <Text style={{ color: 'white', fontWeight: '500' }}>Send reset code</Text>
                          <Feather name="send" size={16} color="white" style={{ marginLeft: 8 }} />
                        </>
                      )}
                    </View>
                  </Button>
                  <TouchableOpacity
                    onPress={() => { setMode('signin'); setError(''); }}
                    style={{ alignItems: 'center', paddingVertical: 12 }}
                  >
                    <Text style={{ fontSize: 14, color: '#00E5FF' }}>Back to sign in</Text>
                  </TouchableOpacity>
                </View>
              ) : mode === 'forgot-password-code' ? (
                <View style={{ gap: 16 }}>
                  <View style={{ alignItems: 'center', marginBottom: 8 }}>
                    <Feather name="mail" size={48} color="#00E5FF" style={{ marginBottom: 12 }} />
                    <Text style={{ fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 8, textAlign: 'center' }}>
                      Check your email
                    </Text>
                    <Text style={{ fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginBottom: 4 }}>
                      Code sent to
                    </Text>
                    <Text style={{ fontSize: 14, color: '#00E5FF', fontWeight: '600' }}>{email}</Text>
                  </View>
                  <View style={{ gap: 8 }}>
                    <Label>Reset code</Label>
                    <Input
                      placeholder="Enter code from email"
                      value={resetCode}
                      onChangeText={(text) => { setResetCode(text); setError(''); }}
                      keyboardType="number-pad"
                      editable={!isLoading}
                    />
                  </View>
                  <View style={{ gap: 8 }}>
                    <Label>New password</Label>
                    <Input
                      placeholder="••••••••"
                      value={newPassword}
                      onChangeText={(text) => { setNewPassword(text); setError(''); }}
                      secureTextEntry={!showPassword}
                      editable={!isLoading}
                    />
                  </View>
                  <Button
                    onPress={handleForgotPasswordReset}
                    disabled={isLoading || !resetCode.trim() || !newPassword.trim()}
                    style={{ width: '100%', height: 48, borderRadius: 24, backgroundColor: '#00E5FF', opacity: (!resetCode.trim() || !newPassword.trim() || isLoading) ? 0.7 : 1 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      {isLoading ? (
                        <View style={{ transform: [{ rotate: `${spinnerRotation}deg` }] }}>
                          <Feather name="loader" size={20} color="white" />
                        </View>
                      ) : (
                        <>
                          <Text style={{ color: 'white', fontWeight: '500' }}>Reset password</Text>
                          <Feather name="check" size={16} color="white" style={{ marginLeft: 8 }} />
                        </>
                      )}
                    </View>
                  </Button>
                  <TouchableOpacity
                    onPress={() => { setMode('forgot-password'); setResetCode(''); setNewPassword(''); setError(''); }}
                    style={{ alignItems: 'center', paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 12, color: '#6B7280' }}>Use a different email</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => { setMode('signin'); setResetCode(''); setNewPassword(''); setError(''); }}
                    style={{ alignItems: 'center', paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 14, color: '#00E5FF' }}>Back to sign in</Text>
                  </TouchableOpacity>
                </View>
              ) : mode === 'verify-email' ? (
                <View style={{ gap: 16 }}>
                  <View style={{ alignItems: 'center', marginBottom: 8 }}>
                    <MaterialIcons name="email" size={48} color="#00E5FF" style={{ marginBottom: 12 }} />
                    <Text style={{ fontSize: 20, fontWeight: 'bold', color: 'white', marginBottom: 8, textAlign: 'center' }}>
                      Check your email
                    </Text>
                    <Text style={{ fontSize: 14, color: '#9CA3AF', textAlign: 'center', marginBottom: 4 }}>
                      We sent a verification code to
                    </Text>
                    <Text style={{ fontSize: 14, color: '#00E5FF', fontWeight: '600' }}>
                      {pendingEmail}
                    </Text>
                  </View>

                  <View style={{ gap: 8 }}>
                    <Label>Verification Code</Label>
                    <Input
                      placeholder="Enter 6-digit code"
                      value={verificationCode}
                      onChangeText={(text) => {
                        setVerificationCode(text.replace(/[^0-9]/g, '').slice(0, 6));
                        setError('');
                      }}
                      keyboardType="number-pad"
                      maxLength={6}
                      editable={!isLoading}
                      style={{ textAlign: 'center', fontSize: 18, letterSpacing: 4 }}
                    />
                  </View>

                  <Button
                    onPress={handleEmailVerification}
                    disabled={isLoading || verificationCode.length !== 6}
                    style={{
                      width: '100%',
                      height: 48,
                      borderRadius: 24,
                      backgroundColor: '#00E5FF',
                      opacity: (verificationCode.length !== 6 || isLoading) ? 0.7 : 1,
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                      {isLoading ? (
                        <View style={{ transform: [{ rotate: `${spinnerRotation}deg` }] }}>
                          <Feather name="loader" size={20} color="white" />
                        </View>
                      ) : (
                        <>
                          <Text style={{ color: 'white', fontWeight: '500' }}>
                            Verify Email
                          </Text>
                          <Feather name="arrow-right" size={16} color="white" style={{ marginLeft: 8 }} />
                        </>
                      )}
                    </View>
                  </Button>

                  <TouchableOpacity
                    onPress={handleResendVerification}
                    disabled={isLoading}
                    style={{ alignItems: 'center', paddingVertical: 12 }}
                  >
                    <Text style={{ fontSize: 14, color: '#00E5FF' }}>
                      Didn't receive the code? Resend
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setMode('signup');
                      setVerificationCode('');
                      setPendingEmail('');
                      setError('');
                    }}
                    style={{ alignItems: 'center', paddingVertical: 8 }}
                  >
                    <Text style={{ fontSize: 12, color: '#6B7280' }}>
                      Back to sign up
                    </Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View>
                  {/* Mode Toggle */}
                  <View style={{ 
                    flexDirection: 'row', 
                    backgroundColor: '#1F2937', 
                    borderRadius: 16, 
                    padding: 4, 
                    marginBottom: 24 
                  }}>
                    {(['signin', 'signup'] as AuthMode[]).map((m) => (
                      <TouchableOpacity
                        key={m}
                        onPress={() => {
                          setMode(m);
                          setError('');
                        }}
                        style={{
                          flex: 1,
                          paddingVertical: 10,
                          borderRadius: 12,
                          backgroundColor: mode === m ? '#0B1220' : 'transparent',
                          shadowColor: '#000',
                          shadowOffset: { width: 0, height: 1 },
                          shadowOpacity: mode === m ? 0.1 : 0,
                          shadowRadius: 2,
                          elevation: mode === m ? 2 : 0,
                        }}
                      >
                        <Text style={{
                          fontSize: 14,
                          fontWeight: '500',
                          textAlign: 'center',
                          color: mode === m ? 'white' : '#6B7280',
                        }}>
                          {m === 'signin' ? 'Sign In' : 'Sign Up'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

              {/* Google Sign In */}
              <Button
                variant="outline"
                onPress={handleGoogleSignIn}
                disabled={isLoading}
                style={{
                  width: '100%',
                  height: 48,
                  borderRadius: 24,
                  borderColor: 'rgba(55, 65, 81, 0.5)',
                  marginBottom: 16,
                  backgroundColor: 'transparent',
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <View style={{ width: 20, height: 20, marginRight: 12 }}>
                    <Text style={{ color: 'white', fontSize: 18 }}>G</Text>
                  </View>
                  <Text style={{ color: 'white', fontSize: 14, fontWeight: '500' }}>
                    Continue with Google
                  </Text>
                </View>
              </Button>

              {/* Divider */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 24 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: '#374151' }} />
                <Text style={{ marginHorizontal: 12, fontSize: 12, color: '#6B7280' }}>
                  or continue with email
                </Text>
                <View style={{ flex: 1, height: 1, backgroundColor: '#374151' }} />
              </View>

              {/* Email Form */}
              <View style={{ gap: 16 }}>
                {/* Email */}
                <View style={{ gap: 8 }}>
                  <Label>Email</Label>
                  <View style={{ position: 'relative' }}>
                    <MaterialIcons
                      name="email"
                      size={16}
                      color="#6B7280"
                      style={{ position: 'absolute', left: 16, top: 16, zIndex: 1 }}
                    />
                    <Input
                      placeholder="you@example.com"
                      value={email}
                      onChangeText={(text) => {
                        setEmail(text);
                        setError('');
                      }}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      editable={!isLoading}
                    />
                  </View>
                </View>

                {/* Password */}
                <View style={{ gap: 8 }}>
                  <Label>Password</Label>
                  <View style={{ position: 'relative' }}>
                    <MaterialIcons
                      name="lock"
                      size={16}
                      color="#6B7280"
                      style={{ position: 'absolute', left: 16, top: 16, zIndex: 1 }}
                    />
                    <Input
                      placeholder="••••••••"
                      value={password}
                      onChangeText={(text) => {
                        setPassword(text);
                        setError('');
                      }}
                      secureTextEntry={!showPassword}
                      editable={!isLoading}
                    />
                    <TouchableOpacity
                      onPress={() => setShowPassword(!showPassword)}
                      style={{ position: 'absolute', right: 16, top: 16 }}
                      disabled={isLoading}
                    >
                      {showPassword ? (
                        <Feather name="eye-off" size={20} color="#6B7280" />
                      ) : (
                        <Feather name="eye" size={20} color="#6B7280" />
                      )}
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Forgot Password */}
                {mode === 'signin' && (
                  <TouchableOpacity
                    onPress={() => { setMode('forgot-password'); setError(''); }}
                    disabled={isLoading}
                  >
                    <Text style={{ fontSize: 12, color: '#00E5FF' }}>
                      Forgot password?
                    </Text>
                  </TouchableOpacity>
                )}

                {/* Submit Button */}
                <Button
                  onPress={handleEmailAuth}
                  disabled={isLoading || !email || !password}
                  style={{
                    width: '100%',
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: '#00E5FF',
                    opacity: (!email || !password || isLoading) ? 0.7 : 1,
                  }}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    {isLoading ? (
                      <View style={{ transform: [{ rotate: `${spinnerRotation}deg` }] }}>
                        <Feather name="loader" size={20} color="white" />
                      </View>
                    ) : (
                      <>
                        <Text style={{ color: 'white', fontWeight: '500' }}>
                          {mode === 'signin' ? 'Sign In' : 'Create Account'}
                        </Text>
                        <Feather name="arrow-right" size={16} color="white" style={{ marginLeft: 8 }} />
                      </>
                    )}
                  </View>
                </Button>
              </View>

              {/* Terms */}
              {mode === 'signup' && (
                <View style={{ marginTop: 16 }}>
                  <Text style={{ fontSize: 12, color: '#6B7280', textAlign: 'center' }}>
                    By signing up, you agree to our{' '}
                    <Text style={{ color: '#00E5FF' }}>Terms</Text> and{' '}
                    <Text style={{ color: '#00E5FF' }}>Privacy Policy</Text>
                  </Text>
                </View>
              )}
                </View>
              )}
            </View>

            {/* Security badge */}
            <View style={{ marginTop: 24, flexDirection: 'row', alignItems: 'center' }}>
              <MaterialIcons name="lock" size={12} color="#6B7280" />
              <Text style={{ fontSize: 12, color: '#6B7280', marginLeft: 6 }}>
                Secured by Clerk
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

export default AuthPage;