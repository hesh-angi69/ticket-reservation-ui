package com.example.ticketreservation.dto;

import com.example.ticketreservation.model.Role;
import jakarta.validation.constraints.Size;

/** Body of PUT /api/admin/users/{id}. Every field is optional: only the ones sent are changed. */
public record UserUpdateRequest(
        @Size(max = 100, message = "fullName must be at most 100 characters") String fullName,
        Role role,
        @Size(min = 6, max = 100, message = "password must be 6-100 characters") String password) {
}
