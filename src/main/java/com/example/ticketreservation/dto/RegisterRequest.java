package com.example.ticketreservation.dto;

import com.example.ticketreservation.model.Role;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * role is optional. Anonymous callers always become CUSTOMER;
 * only an ADMIN may create ADMIN or ORGANIZER accounts.
 */
public record RegisterRequest(
        @NotBlank(message = "username is required")
        @Size(min = 3, max = 50, message = "username must be 3-50 characters") String username,
        @NotBlank(message = "password is required")
        @Size(min = 6, max = 100, message = "password must be 6-100 characters") String password,
        @NotBlank(message = "fullName is required") String fullName,
        Role role) {
}
