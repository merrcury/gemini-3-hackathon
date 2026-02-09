// components/ui/button.tsx
import * as React from "react";
import { TouchableOpacity, Text } from "react-native";

interface ButtonProps {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  size?: "default" | "sm" | "lg" | "icon";
  children?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: any;
  [key: string]: any; // For any other props
}

const Button = React.forwardRef((props: ButtonProps, ref: any) => {
  const { 
    variant = "default", 
    size = "default", 
    children, 
    style,
    onPress,
    disabled,
    ...rest 
  } = props;

  // Get styles based on variant
  let backgroundColor = '#00E5FF';
  let borderWidth = 0;
  let borderColor = 'transparent';
  
  switch (variant) {
    case "destructive":
      backgroundColor = '#EF4444';
      break;
    case "outline":
      backgroundColor = 'transparent';
      borderWidth = 1;
      borderColor = '#374151';
      break;
    case "secondary":
      backgroundColor = '#374151';
      break;
    case "ghost":
    case "link":
      backgroundColor = 'transparent';
      break;
  }

  // Get size styles
  let height = 40;
  let paddingHorizontal = 16;
  
  switch (size) {
    case "sm":
      height = 36;
      paddingHorizontal = 12;
      break;
    case "lg":
      height = 44;
      paddingHorizontal = 32;
      break;
    case "icon":
      height = 40;
      const width = 40;
      paddingHorizontal = 0;
      break;
  }

  // Text color
  const textColor = variant === 'outline' || variant === 'ghost' || variant === 'link' ? 'white' : '#000000';

  return (
    <TouchableOpacity
      ref={ref}
      style={[{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        backgroundColor,
        borderWidth,
        borderColor,
        height,
        paddingHorizontal,
      }, style]}
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled}
      {...rest}
    >
      {React.Children.map(children, (child) => {
        if (typeof child === 'string') {
          return (
            <Text style={{
              color: textColor,
              fontSize: 14,
              fontWeight: '500',
            }}>
              {child}
            </Text>
          );
        }
        return child;
      })}
    </TouchableOpacity>
  );
});

Button.displayName = "Button";

export { Button };